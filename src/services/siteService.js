import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { normalizePhone } from './crmService.js';

export const SITE_SECTIONS = ['hero', 'properties', 'about', 'areas', 'reviews', 'calculator', 'contact'];
const EVENT_TYPES = ['open', 'section_view', 'scroll', 'cta_book', 'cta_whatsapp', 'brochure_download', 'booking_submit'];

const DEFAULT_SECTIONS = {
  hero: true,
  properties: true,
  about: true,
  areas: true,
  reviews: true,
  calculator: false,
  contact: true,
};

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function defaultHeadline(areas) {
  const list = (areas || []).map((area) => String(area).trim()).filter(Boolean);
  if (list.length >= 2) return `Homes in ${list[0]} & ${list[1]}, chosen with care.`;
  if (list.length === 1) return `Homes in ${list[0]}, chosen with care.`;
  return 'Homes chosen with care.';
}

export function normalizeDomain(value) {
  if (value == null || String(value).trim() === '') return null;
  const host = String(value).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) {
    throw fail(400, 'validation', 'Enter a domain like homes.example.com.');
  }
  if (host.endsWith('.hycin.site')) throw fail(400, 'validation', 'That address is already the HYCIN site.');
  return host;
}

export function assertCustomDomain(allowed, domain) {
  const host = normalizeDomain(domain);
  if (host && !allowed) throw fail(403, 'plan_required', 'A custom domain is on the Elite plan.');
  return host;
}

function blank(value, max) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function listOf(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
}

export function buildSlots({ now = new Date(), days = 5, workDays = [1, 2, 3, 4, 5, 6], workFrom = '10:00', workTo = '18:00', visitMinutes = 60, noticeHours = 3, busy = [] }) {
  const [fromHour, fromMinute] = workFrom.split(':').map(Number);
  const [toHour, toMinute] = workTo.split(':').map(Number);
  const startMinute = fromHour * 60 + fromMinute;
  const endMinute = toHour * 60 + toMinute;
  const notice = new Date(now.getTime() + noticeHours * 60 * 60 * 1000);
  const groups = [];
  for (let offset = 0; offset < days + 14 && groups.length < days; offset += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (!workDays.includes(day.getDay())) continue;
    const times = [];
    for (let minute = startMinute; minute + visitMinutes <= endMinute; minute += 30) {
      const slot = new Date(day);
      slot.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      if (slot < notice) continue;
      const slotEnd = slot.getTime() + visitMinutes * 60 * 1000;
      const overlaps = busy.some((visit) => {
        const start = new Date(visit.startAt).getTime();
        const end = new Date(visit.endAt || start + visitMinutes * 60 * 1000).getTime();
        return slot.getTime() < end && slotEnd > start;
      });
      if (!overlaps) times.push(slot.toISOString());
    }
    if (times.length) {
      groups.push({
        day: day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        slots: times,
      });
    }
  }
  return groups;
}

export function createSiteService({ models }) {
  const { Tenant, Site, SiteEvent, Property, Lead, Visit, TimelineEvent, PlatformSetting, sequelize } = {
    ...models,
    sequelize: models.Tenant.sequelize,
  };

  async function themes() {
    const row = await PlatformSetting.findByPk('themes');
    const items = row?.value?.items || [];
    return items.filter((item) => item.on !== false);
  }

  async function domainAllowed(tenant) {
    const row = await PlatformSetting.findByPk('plans');
    const plan = (row?.value?.items || []).find((item) => item.k === tenant.planKey);
    return Boolean(plan?.features?.domain);
  }

  async function ensure(tenantId) {
    let site = await Site.findByPk(tenantId);
    if (!site) {
      site = await Site.create({
        tenantId,
        themeKey: 'forest',
        languages: [],
        areas: [],
        sections: DEFAULT_SECTIONS,
        domainStatus: 'none',
      });
    }
    return site;
  }

  function sectionsOf(site) {
    return { ...DEFAULT_SECTIONS, ...(site.sections || {}) };
  }

  function presentProperty(property) {
    return {
      id: property.id,
      slug: property.slug,
      name: property.name,
      developer: property.developer,
      location: property.location,
      typeLabel: property.typeLabel,
      sizeRange: property.sizeRange,
      priceFrom: property.priceFrom,
      possession: property.possession,
      status: property.status,
      stageLabel: property.stageLabel,
      reraOrHoa: property.reraOrHoa,
      amenities: property.amenities || [],
    };
  }

  async function present(site, tenant, { includeDrafts = false } = {}) {
    const palette = await themes();
    const theme = palette.find((item) => item.k === site.themeKey) || palette[0] || { k: 'forest', n: 'Forest', bg: '#1E2A24', fg: '#F4EFE6', ac: '#C9B78F', font: 'Georgia, serif' };
    const where = { tenantId: tenant.id };
    if (!includeDrafts) where.status = 'live';
    else where.status = { [Op.ne]: 'archived' };
    const properties = await Property.findAll({ where, order: [['createdAt', 'DESC']] });
    const families = await Lead.count({ where: { tenantId: tenant.id, stage: 'won', archivedAt: null } });
    const areas = site.areas || [];
    return {
      slug: tenant.slug,
      name: tenant.name,
      brand: tenant.brand || tenant.name,
      market: tenant.market,
      phone: tenant.phone,
      host: `${tenant.slug}.hycin.site`,
      published: Boolean(site.publishedAt),
      publishedAt: site.publishedAt,
      theme,
      themes: palette,
      headline: site.headline || defaultHeadline(areas),
      tagline: site.tagline,
      about: site.about,
      languages: site.languages || [],
      licenceNo: site.licenceNo,
      yearsLabel: site.yearsLabel,
      areas,
      whatsapp: site.whatsapp || tenant.phone,
      review: site.reviewQuote ? {
        quote: site.reviewQuote,
        author: site.reviewAuthor,
        rating: site.reviewRating,
        count: site.reviewCount,
      } : null,
      sections: sectionsOf(site),
      customDomain: site.customDomain,
      domainStatus: site.domainStatus,
      domainAllowed: await domainAllowed(tenant),
      seo: { title: site.seoTitle, description: site.seoDescription },
      stats: { families, projects: properties.filter((property) => property.status === 'live').length },
      properties: properties.map(presentProperty),
    };
  }

  async function apply(site, tenant, input) {
    const palette = await themes();
    if (input.themeKey) {
      if (!palette.some((item) => item.k === input.themeKey)) throw fail(400, 'validation', 'Choose a theme from the list.');
      site.themeKey = input.themeKey;
    }
    if (input.headline !== undefined) site.headline = blank(input.headline, 240);
    if (input.tagline !== undefined) site.tagline = blank(input.tagline, 500);
    if (input.about !== undefined) site.about = blank(input.about, 2000);
    if (input.languages) site.languages = listOf(input.languages, 12, 40);
    if (input.licenceNo !== undefined) site.licenceNo = blank(input.licenceNo, 80);
    if (input.yearsLabel !== undefined) site.yearsLabel = blank(input.yearsLabel, 40);
    if (input.areas) site.areas = listOf(input.areas, 12, 80);
    if (input.whatsapp !== undefined) site.whatsapp = normalizePhone(input.whatsapp);
    if (input.reviewQuote !== undefined) site.reviewQuote = blank(input.reviewQuote, 500);
    if (input.reviewAuthor !== undefined) site.reviewAuthor = blank(input.reviewAuthor, 160);
    if (input.reviewRating !== undefined) site.reviewRating = blank(input.reviewRating, 16);
    if (input.reviewCount !== undefined) site.reviewCount = input.reviewCount == null ? null : Number(input.reviewCount);
    if (input.sections) {
      const next = sectionsOf(site);
      for (const key of SITE_SECTIONS) {
        if (typeof input.sections[key] === 'boolean') next[key] = input.sections[key];
      }
      site.sections = next;
    }
    if (input.customDomain !== undefined) {
      const host = assertCustomDomain(await domainAllowed(tenant), input.customDomain);
      if (host) {
        const taken = await Site.findOne({ where: { customDomain: host, tenantId: { [Op.ne]: tenant.id } } });
        if (taken) throw fail(409, 'domain_taken', 'That domain is already used by another workspace.');
      }
      site.customDomain = host;
      site.domainStatus = host ? 'pending' : 'none';
    }
    if (input.seoTitle !== undefined) site.seoTitle = blank(input.seoTitle, 160);
    if (input.seoDescription !== undefined) site.seoDescription = blank(input.seoDescription, 300);
    await site.save();
    return site;
  }

  async function publishedTenant(slug) {
    const tenant = await Tenant.findOne({ where: { slug, status: 'active' } });
    if (!tenant) throw fail(404, 'not_found', 'This website was not found.');
    const site = await Site.findByPk(tenant.id);
    if (!site?.publishedAt) throw fail(404, 'site_unpublished', 'This website is not published yet.');
    return { tenant, site };
  }

  async function record(tenantId, input, ipHash) {
    const property = input.propertyId
      ? await Property.findOne({ where: { id: input.propertyId, tenantId } })
      : input.propertySlug
        ? await Property.findOne({ where: { slug: input.propertySlug, tenantId, status: 'live' } })
        : null;
    await SiteEvent.create({
      id: crypto.randomUUID(),
      tenantId,
      propertyId: property?.id || null,
      sessionId: String(input.sessionId).slice(0, 64),
      type: input.type,
      path: blank(input.path, 255),
      referrer: blank(input.referrer, 500),
      utmSource: blank(input.utmSource, 80),
      ipHash: ipHash || null,
      payload: input.payload || null,
    });
  }

  return {
    async workspace(tenantId) {
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) throw fail(404, 'not_found', 'Workspace not found.');
      const site = await ensure(tenantId);
      const page = await present(site, tenant, { includeDrafts: true });
      page.analytics = await this.analytics(tenantId);
      return page;
    },

    async save(tenantId, input) {
      const tenant = await Tenant.findByPk(tenantId);
      const site = await ensure(tenantId);
      await apply(site, tenant, input);
      return this.workspace(tenantId);
    },

    async publish(tenantId, input) {
      const tenant = await Tenant.findByPk(tenantId);
      const site = await ensure(tenantId);
      if (input) await apply(site, tenant, input);
      site.publishedAt = new Date();
      await site.save();
      return this.workspace(tenantId);
    },

    async analytics(tenantId) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const where = { tenantId, createdAt: { [Op.gte]: since } };
      const [visits, uniqueVisitors, bookings, whatsapp, sourceRows, projectRows] = await Promise.all([
        SiteEvent.count({ where: { ...where, type: 'open' } }),
        SiteEvent.count({ where: { ...where, type: 'open' }, distinct: true, col: 'session_id' }),
        SiteEvent.count({ where: { ...where, type: 'booking_submit' } }),
        SiteEvent.count({ where: { ...where, type: 'cta_whatsapp' } }),
        SiteEvent.findAll({
          attributes: ['utmSource', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
          where: { ...where, type: 'open' },
          group: ['utm_source'],
          raw: true,
        }),
        SiteEvent.findAll({
          attributes: ['propertyId', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
          where: { ...where, type: 'open', propertyId: { [Op.ne]: null } },
          group: ['property_id'],
          raw: true,
        }),
      ]);
      const ranked = [...projectRows].sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 5);
      const ids = ranked.map((row) => row.propertyId || row.property_id);
      const properties = ids.length ? await Property.findAll({ where: { id: ids, tenantId } }) : [];
      const names = new Map(properties.map((property) => [property.id, property.name]));
      return {
        days: 30,
        visits,
        uniqueVisitors,
        enquiries: bookings + whatsapp,
        sources: sourceRows.map((row) => ({ source: row.utmSource || row.utm_source || 'direct', count: Number(row.total) })),
        topProjects: ranked.map((row) => {
          const id = row.propertyId || row.property_id;
          return { id, name: names.get(id) || 'Property', visits: Number(row.total) };
        }),
      };
    },

    async publicPage(slug) {
      const { tenant, site } = await publishedTenant(slug);
      const page = await present(site, tenant);
      delete page.themes;
      delete page.domainAllowed;
      return page;
    },

    async publicProperty(slug, propertySlug) {
      const page = await this.publicPage(slug);
      const property = page.properties.find((item) => item.slug === propertySlug);
      if (!property) throw fail(404, 'not_found', 'This project is not on the site.');
      return { site: page, property };
    },

    async slots(slug) {
      const { tenant } = await publishedTenant(slug);
      const busy = await Visit.findAll({
        where: { tenantId: tenant.id, status: { [Op.notIn]: ['cancelled', 'no_show'] }, startAt: { [Op.gte]: new Date() } },
      });
      return buildSlots({ busy });
    },

    async book({ slug, name, phone, startAt, propertySlug }) {
      const { tenant, site } = await publishedTenant(slug);
      const when = new Date(startAt);
      const offered = (await this.slots(slug)).flatMap((group) => group.slots);
      if (!offered.includes(when.toISOString())) throw fail(400, 'validation', 'That time is no longer open.');
      const property = propertySlug
        ? await Property.findOne({ where: { tenantId: tenant.id, slug: propertySlug, status: 'live' } })
        : null;
      const normalized = normalizePhone(phone);
      if (!normalized) throw fail(400, 'validation', 'Enter a WhatsApp number.');
      return sequelize.transaction(async (transaction) => {
        let lead = await Lead.findOne({ where: { tenantId: tenant.id, phone: normalized, archivedAt: null }, transaction });
        const created = !lead;
        if (!lead) {
          lead = await Lead.create({
            id: crypto.randomUUID(),
            tenantId: tenant.id,
            name,
            phone: normalized,
            source: 'public_site',
            sourceDetail: property?.name || tenant.name,
            propertyId: property?.id || null,
            stage: 'new',
            priority: 'normal',
            score: 0,
            preferredChannel: 'whatsapp',
            lastActivityAt: new Date(),
          }, { transaction });
          await TimelineEvent.create({
            id: crypto.randomUUID(),
            tenantId: tenant.id,
            leadId: lead.id,
            type: 'created',
            summary: 'Lead added from the website',
          }, { transaction });
        }
        const visit = await Visit.create({
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          leadId: lead.id,
          propertyId: property?.id || lead.propertyId,
          startAt: when,
          endAt: new Date(when.getTime() + 60 * 60 * 1000),
          type: 'site',
          source: 'public_site',
          status: 'booked',
        }, { transaction });
        if (['new', 'talking'].includes(lead.stage)) lead.stage = 'visit';
        lead.lastActivityAt = new Date();
        if (!lead.propertyId && property) lead.propertyId = property.id;
        await lead.save({ transaction });
        await TimelineEvent.create({
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          leadId: lead.id,
          type: 'visit',
          summary: `Visit booked from the website for ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
        }, { transaction });
        await SiteEvent.create({
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          propertyId: property?.id || null,
          sessionId: crypto.randomUUID(),
          type: 'booking_submit',
          path: `/${tenant.slug}/visit`,
        }, { transaction });
        return { visitId: visit.id, leadId: lead.id, tenantId: tenant.id, created, startAt: when.toISOString() };
      });
    },

    async track(slug, input, ipHash) {
      if (!EVENT_TYPES.includes(input.type)) throw fail(400, 'validation', 'Unknown site event.');
      const { tenant } = await publishedTenant(slug);
      await record(tenant.id, input, ipHash);
      return { ok: true };
    },
  };
}
