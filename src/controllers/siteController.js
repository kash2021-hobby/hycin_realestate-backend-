import crypto from 'node:crypto';
import { z } from 'zod';

const text = (max) => z.string().max(max).optional().nullable();

const siteSchema = z.object({
  themeKey: z.string().max(32).optional(),
  headline: text(240),
  tagline: text(500),
  about: text(2000),
  languages: z.array(z.string().max(40)).max(12).optional(),
  licenceNo: text(80),
  yearsLabel: text(40),
  areas: z.array(z.string().max(80)).max(12).optional(),
  whatsapp: text(32),
  reviewQuote: text(500),
  reviewAuthor: text(160),
  reviewRating: text(16),
  reviewCount: z.number().int().min(0).max(100000).optional().nullable(),
  sections: z.object({
    hero: z.boolean().optional(),
    properties: z.boolean().optional(),
    about: z.boolean().optional(),
    areas: z.boolean().optional(),
    reviews: z.boolean().optional(),
    calculator: z.boolean().optional(),
    contact: z.boolean().optional(),
  }).optional(),
  customDomain: text(255),
  seoTitle: text(160),
  seoDescription: text(300),
});

const bookSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(32),
  startAt: z.string().min(4),
  propertySlug: z.string().max(80).optional().nullable(),
});

const eventSchema = z.object({
  slug: z.string().min(2).max(80),
  sessionId: z.string().min(8).max(64),
  type: z.enum(['open', 'section_view', 'scroll', 'cta_book', 'cta_whatsapp', 'brochure_download', 'booking_submit']),
  propertySlug: z.string().max(80).optional().nullable(),
  path: z.string().max(255).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
  utmSource: z.string().max(80).optional().nullable(),
  section: z.string().max(40).optional().nullable(),
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || 'Check the form and try again.');
    error.status = 400;
    error.code = 'validation';
    throw error;
  }
  return result.data;
}

function ipHash(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

export function siteController(site, sheets) {
  return {
    async get(req, res, next) {
      try {
        res.json({ site: await site.workspace(req.auth.tenantId) });
      } catch (error) {
        next(error);
      }
    },
    async update(req, res, next) {
      try {
        const body = parse(siteSchema, req.body || {});
        res.json({ site: await site.save(req.auth.tenantId, body) });
      } catch (error) {
        next(error);
      }
    },
    async publish(req, res, next) {
      try {
        const body = parse(siteSchema, req.body || {});
        res.json({ site: await site.publish(req.auth.tenantId, body) });
      } catch (error) {
        next(error);
      }
    },
    async analytics(req, res, next) {
      try {
        res.json({ analytics: await site.analytics(req.auth.tenantId) });
      } catch (error) {
        next(error);
      }
    },
    async publicSite(req, res, next) {
      try {
        res.json({ site: await site.publicPage(req.params.slug) });
      } catch (error) {
        next(error);
      }
    },
    async publicProperty(req, res, next) {
      try {
        res.json(await site.publicProperty(req.params.slug, req.params.propertySlug));
      } catch (error) {
        next(error);
      }
    },
    async slots(req, res, next) {
      try {
        res.json({ slots: await site.slots(req.params.slug) });
      } catch (error) {
        next(error);
      }
    },
    async book(req, res, next) {
      try {
        const body = parse(bookSchema, req.body || {});
        const booked = await site.book({ slug: req.params.slug, ...body });
        if (sheets) await sheets.noteLead(booked.tenantId, booked.leadId);
        res.status(201).json({
          visit: { id: booked.visitId, startAt: booked.startAt },
          leadId: booked.leadId,
        });
      } catch (error) {
        next(error);
      }
    },
    async event(req, res, next) {
      try {
        const body = parse(eventSchema, req.body || {});
        await site.track(body.slug, {
          ...body,
          payload: body.section ? { section: body.section } : null,
        }, ipHash(req));
        res.status(202).json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  };
}
