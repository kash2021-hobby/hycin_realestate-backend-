import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { LEAD_STAGES, ROLES } from '@hycin/shared';

const SOURCES = ['manual', 'walk-in', 'referral', 'call', 'portal', 'instagram', 'facebook', 'whatsapp', 'meta', 'google', 'sheets', 'youtube', 'public_site'];
const STAGES = LEAD_STAGES;

export function normalizePhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  return digits || null;
}

export function leadWhere(tenantId, query = {}) {
  const where = { tenantId, archivedAt: null };
  if (query.stage && STAGES.includes(query.stage)) where.stage = query.stage;
  if (query.source && SOURCES.includes(query.source)) where.source = query.source;
  if (query.priority) where.priority = query.priority;
  if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
  if (query.q) {
    const like = `%${String(query.q).slice(0, 80)}%`;
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
      { email: { [Op.like]: like } },
      { need: { [Op.like]: like } },
    ];
  }
  return where;
}

function fail(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) Object.assign(error, extra);
  return error;
}

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return base || 'property';
}

export function createCrmService({ models }) {
  const { Property, Lead, TimelineEvent, Visit, User, Membership, AuditLog, sequelize } = {
    ...models,
    sequelize: models.Lead.sequelize,
  };

  async function timeline(transaction, { tenantId, leadId, type, summary, actorUserId }) {
    await TimelineEvent.create({
      id: crypto.randomUUID(),
      tenantId,
      leadId,
      type,
      summary,
      actorUserId,
    }, { transaction });
  }

  async function memberUserIds(tenantId, transaction) {
    const rows = await Membership.findAll({ where: { tenantId }, transaction });
    return new Set(rows.map((row) => row.userId));
  }

  return {
    async summary(tenantId) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const [leads7d, visits7d, byStageRows, todayVisits, hottest, due] = await Promise.all([
        Lead.count({ where: { tenantId, archivedAt: null, createdAt: { [Op.gte]: weekAgo } } }),
        Visit.count({ where: { tenantId, createdAt: { [Op.gte]: weekAgo }, status: { [Op.ne]: 'cancelled' } } }),
        Lead.findAll({
          attributes: ['stage', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { tenantId, archivedAt: null },
          group: ['stage'],
          raw: true,
        }),
        Visit.findAll({
          where: { tenantId, startAt: { [Op.gte]: start, [Op.lt]: end }, status: { [Op.notIn]: ['cancelled'] } },
          include: [{ model: Lead }, { model: Property }],
          order: [['startAt', 'ASC']],
        }),
        Lead.findAll({ where: { tenantId, archivedAt: null }, order: [['score', 'DESC'], ['lastActivityAt', 'DESC']], limit: 4, include: [{ model: Property }] }),
        Lead.findAll({ where: { tenantId, archivedAt: null, followUpAt: { [Op.lte]: new Date() } }, order: [['followUpAt', 'ASC']], limit: 5 }),
      ]);
      const byStage = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
      for (const row of byStageRows) byStage[row.stage] = Number(row.count);
      return { leads7d, visits7d, byStage, todayVisits, hottest, due };
    },

    async listLeads(tenantId, query) {
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
      const where = leadWhere(tenantId, query);
      const { rows, count } = await Lead.findAndCountAll({
        where,
        include: [{ model: Property }, { model: User, as: 'Owner' }],
        order: [['lastActivityAt', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { rows, total: count, page, pageSize };
    },

    async getLead(tenantId, id) {
      const lead = await Lead.findOne({
        where: { id, tenantId },
        include: [{ model: Property }, { model: User, as: 'Owner' }],
      });
      if (!lead || lead.archivedAt) throw fail(404, 'not_found', 'Lead not found.');
      const events = await TimelineEvent.findAll({ where: { tenantId, leadId: id }, order: [['createdAt', 'DESC']], limit: 50 });
      const visits = await Visit.findAll({ where: { tenantId, leadId: id }, order: [['startAt', 'DESC']] });
      return { lead, events, visits };
    },

    async createLead({ tenantId, actorUserId, input }) {
      const phone = normalizePhone(input.phone);
      const email = input.email ? String(input.email).toLowerCase() : null;
      return sequelize.transaction(async (transaction) => {
        if (phone) {
          const existing = await Lead.findOne({ where: { tenantId, phone, archivedAt: null }, transaction });
          if (existing) throw fail(409, 'duplicate_lead', `This phone already belongs to ${existing.name}.`, { leadId: existing.id });
        }
        if (email) {
          const existing = await Lead.findOne({ where: { tenantId, email, archivedAt: null }, transaction });
          if (existing) throw fail(409, 'duplicate_lead', `This email already belongs to ${existing.name}.`, { leadId: existing.id });
        }
        if (input.propertyId) {
          const property = await Property.findOne({ where: { id: input.propertyId, tenantId }, transaction });
          if (!property) throw fail(400, 'validation', 'Choose a property from this workspace.');
        }
        if (input.ownerUserId) {
          const members = await memberUserIds(tenantId, transaction);
          if (!members.has(input.ownerUserId)) throw fail(400, 'validation', 'Assign someone from this workspace.');
        }
        const now = new Date();
        const lead = await Lead.create({
          id: crypto.randomUUID(),
          tenantId,
          name: input.name,
          phone,
          email,
          source: SOURCES.includes(input.source) ? input.source : 'manual',
          sourceDetail: input.sourceDetail || null,
          propertyId: input.propertyId || null,
          budget: input.budget || null,
          need: input.need || null,
          stage: 'new',
          priority: ['low', 'normal', 'high'].includes(input.priority) ? input.priority : 'normal',
          score: 0,
          preferredChannel: input.preferredChannel || null,
          ownerUserId: input.ownerUserId || actorUserId,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          lastActivityAt: now,
        }, { transaction });
        await timeline(transaction, { tenantId, leadId: lead.id, type: 'created', summary: 'Lead added', actorUserId });
        return lead;
      });
    },

    async updateLead({ tenantId, actorUserId, id, input }) {
      return sequelize.transaction(async (transaction) => {
        const lead = await Lead.findOne({ where: { id, tenantId, archivedAt: null }, transaction });
        if (!lead) throw fail(404, 'not_found', 'Lead not found.');
        if (input.stage && STAGES.includes(input.stage) && input.stage !== lead.stage) {
          lead.stage = input.stage;
          await timeline(transaction, { tenantId, leadId: lead.id, type: 'stage', summary: `Stage moved to ${input.stage}`, actorUserId });
        }
        if (Object.prototype.hasOwnProperty.call(input, 'ownerUserId') && input.ownerUserId !== lead.ownerUserId) {
          if (input.ownerUserId) {
            const members = await memberUserIds(tenantId, transaction);
            if (!members.has(input.ownerUserId)) throw fail(400, 'validation', 'Assign someone from this workspace.');
          }
          lead.ownerUserId = input.ownerUserId || null;
          await timeline(transaction, { tenantId, leadId: lead.id, type: 'assigned', summary: 'Lead assignment changed', actorUserId });
        }
        for (const field of ['name', 'budget', 'need', 'sourceDetail', 'preferredChannel', 'priority']) {
          if (input[field] !== undefined) lead[field] = input[field] || null;
        }
        if (input.phone !== undefined) lead.phone = normalizePhone(input.phone);
        if (input.email !== undefined) lead.email = input.email ? String(input.email).toLowerCase() : null;
        if (input.propertyId !== undefined) {
          if (input.propertyId) {
            const property = await Property.findOne({ where: { id: input.propertyId, tenantId }, transaction });
            if (!property) throw fail(400, 'validation', 'Choose a property from this workspace.');
          }
          lead.propertyId = input.propertyId || null;
        }
        if (input.followUpAt !== undefined) lead.followUpAt = input.followUpAt ? new Date(input.followUpAt) : null;
        lead.lastActivityAt = new Date();
        await lead.save({ transaction });
        return lead;
      });
    },

    async addNote({ tenantId, actorUserId, id, summary }) {
      return sequelize.transaction(async (transaction) => {
        const lead = await Lead.findOne({ where: { id, tenantId, archivedAt: null }, transaction });
        if (!lead) throw fail(404, 'not_found', 'Lead not found.');
        lead.lastActivityAt = new Date();
        await lead.save({ transaction });
        await timeline(transaction, { tenantId, leadId: id, type: 'note', summary, actorUserId });
      });
    },

    async archiveLead({ tenantId, actorUserId, id }) {
      const lead = await Lead.findOne({ where: { id, tenantId, archivedAt: null } });
      if (!lead) throw fail(404, 'not_found', 'Lead not found.');
      lead.archivedAt = new Date();
      lead.lastActivityAt = new Date();
      await lead.save();
      await TimelineEvent.create({
        id: crypto.randomUUID(),
        tenantId,
        leadId: id,
        type: 'archived',
        summary: 'Lead archived',
        actorUserId,
      });
    },

    async listProperties(tenantId) {
      return Property.findAll({ where: { tenantId, status: { [Op.ne]: 'archived' } }, order: [['createdAt', 'DESC']] });
    },

    async createProperty({ tenantId, input }) {
      let slug = slugify(input.name);
      const taken = await Property.findOne({ where: { tenantId, slug } });
      if (taken) slug = `${slug}-${crypto.randomUUID().slice(0, 4)}`;
      return Property.create({
        id: crypto.randomUUID(),
        tenantId,
        name: input.name,
        slug,
        developer: input.developer || null,
        location: input.location || null,
        typeLabel: input.typeLabel || null,
        sizeRange: input.sizeRange || null,
        priceFrom: input.priceFrom || null,
        possession: input.possession || null,
        status: input.status === 'live' ? 'live' : 'draft',
        stageLabel: input.stageLabel || null,
        reraOrHoa: input.reraOrHoa || null,
        amenities: Array.isArray(input.amenities) ? input.amenities : [],
      });
    },

    async updateProperty({ tenantId, id, input }) {
      const property = await Property.findOne({ where: { id, tenantId } });
      if (!property) throw fail(404, 'not_found', 'Property not found.');
      for (const field of ['name', 'developer', 'location', 'typeLabel', 'sizeRange', 'priceFrom', 'possession', 'stageLabel', 'reraOrHoa']) {
        if (input[field] !== undefined) property[field] = input[field] || null;
      }
      if (input.status && ['draft', 'live', 'archived'].includes(input.status)) property.status = input.status;
      if (Array.isArray(input.amenities)) property.amenities = input.amenities;
      await property.save();
      return property;
    },

    async listVisits(tenantId, from, to) {
      const where = { tenantId };
      if (from || to) where.startAt = {};
      if (from) where.startAt[Op.gte] = new Date(from);
      if (to) where.startAt[Op.lt] = new Date(to);
      return Visit.findAll({
        where,
        include: [{ model: Lead }, { model: Property }],
        order: [['startAt', 'ASC']],
      });
    },

    async createVisit({ tenantId, actorUserId, input }) {
      return sequelize.transaction(async (transaction) => {
        const lead = await Lead.findOne({ where: { id: input.leadId, tenantId, archivedAt: null }, transaction });
        if (!lead) throw fail(404, 'not_found', 'Lead not found.');
        if (input.propertyId) {
          const property = await Property.findOne({ where: { id: input.propertyId, tenantId }, transaction });
          if (!property) throw fail(400, 'validation', 'Choose a property from this workspace.');
        }
        const startAt = new Date(input.startAt);
        if (Number.isNaN(startAt.getTime())) throw fail(400, 'validation', 'Choose a visit time.');
        const visit = await Visit.create({
          id: crypto.randomUUID(),
          tenantId,
          leadId: lead.id,
          propertyId: input.propertyId || lead.propertyId,
          startAt,
          endAt: input.endAt ? new Date(input.endAt) : new Date(startAt.getTime() + 60 * 60 * 1000),
          type: ['site', 'video', 'phone'].includes(input.type) ? input.type : 'site',
          source: 'agent',
          status: 'booked',
          notes: input.notes || null,
        }, { transaction });
        if (['new', 'talking'].includes(lead.stage)) lead.stage = 'visit';
        lead.lastActivityAt = new Date();
        await lead.save({ transaction });
        await timeline(transaction, {
          tenantId,
          leadId: lead.id,
          type: 'visit',
          summary: `Visit booked for ${startAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
          actorUserId,
        });
        return visit;
      });
    },

    async updateVisit({ tenantId, actorUserId, id, input }) {
      const visit = await Visit.findOne({ where: { id, tenantId }, include: [{ model: Lead }] });
      if (!visit) throw fail(404, 'not_found', 'Visit not found.');
      if (input.status && ['booked', 'visited', 'no_show', 'rescheduled', 'cancelled'].includes(input.status)) {
        visit.status = input.status;
        if (visit.Lead && visit.Lead.tenantId === tenantId) {
          if (input.status === 'visited') visit.Lead.stage = 'visited';
          if (input.status === 'cancelled' && visit.Lead.stage === 'visit') visit.Lead.stage = 'talking';
          visit.Lead.lastActivityAt = new Date();
          await visit.Lead.save();
          await TimelineEvent.create({
            id: crypto.randomUUID(),
            tenantId,
            leadId: visit.leadId,
            type: 'visit',
            summary: `Visit marked ${input.status.replace('_', ' ')}`,
            actorUserId,
          });
        }
      }
      await visit.save();
      return visit;
    },

    async listMembers(tenantId) {
      return Membership.findAll({ where: { tenantId }, include: [{ model: User }], order: [['createdAt', 'ASC']] });
    },

    async addMember({ tenantId, actorUserId, input }) {
      if (!ROLES.includes(input.role)) throw fail(400, 'validation', 'Choose a workspace role.');
      const email = String(input.email).toLowerCase();
      return sequelize.transaction(async (transaction) => {
        let user = await User.findOne({ where: { email }, transaction });
        if (!user) {
          if (!input.password || input.password.length < 10) throw fail(400, 'weak_password', 'The password must be at least 10 characters.');
          user = await User.create({
            id: crypto.randomUUID(),
            email,
            name: input.name,
            passwordHash: await bcrypt.hash(input.password, 12),
            isSuperAdmin: false,
          }, { transaction });
        }
        const existing = await Membership.findOne({ where: { tenantId, userId: user.id }, transaction });
        if (existing) throw fail(409, 'already_member', 'That person is already in this workspace.');
        const membership = await Membership.create({
          id: crypto.randomUUID(),
          tenantId,
          userId: user.id,
          role: input.role,
        }, { transaction });
        await AuditLog.create({
          id: crypto.randomUUID(),
          actorUserId,
          tenantId,
          action: 'member.add',
          targetType: 'membership',
          targetId: membership.id,
          metadata: { role: input.role },
        }, { transaction });
        return membership;
      });
    },

    async updateMemberRole({ tenantId, actorUserId, membershipId, role }) {
      if (!ROLES.includes(role)) throw fail(400, 'validation', 'Choose a workspace role.');
      const membership = await Membership.findOne({ where: { id: membershipId, tenantId } });
      if (!membership) throw fail(404, 'not_found', 'Person not found.');
      if (membership.role === 'tenant_admin' && role !== 'tenant_admin') {
        const admins = await Membership.count({ where: { tenantId, role: 'tenant_admin' } });
        if (admins <= 1) throw fail(400, 'last_admin', 'Keep at least one workspace admin.');
      }
      membership.role = role;
      await membership.save();
      await AuditLog.create({
        id: crypto.randomUUID(),
        actorUserId,
        tenantId,
        action: 'member.role',
        targetType: 'membership',
        targetId: membership.id,
        metadata: { role },
      });
      return membership;
    },
  };
}
