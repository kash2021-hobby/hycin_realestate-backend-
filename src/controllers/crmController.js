import { z } from 'zod';

const leadSchema = z.object({
  name: z.string().min(2).max(160),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  source: z.string().max(32).optional(),
  sourceDetail: z.string().max(160).optional().nullable(),
  propertyId: z.string().uuid().optional().nullable(),
  budget: z.string().max(80).optional().nullable(),
  need: z.string().max(160).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  preferredChannel: z.string().max(32).optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  followUpAt: z.string().optional().nullable(),
});

const propertySchema = z.object({
  name: z.string().min(2).max(160),
  developer: z.string().max(160).optional().nullable(),
  location: z.string().max(160).optional().nullable(),
  typeLabel: z.string().max(80).optional().nullable(),
  sizeRange: z.string().max(80).optional().nullable(),
  priceFrom: z.string().max(40).optional().nullable(),
  possession: z.string().max(80).optional().nullable(),
  status: z.enum(['draft', 'live', 'archived']).optional(),
  stageLabel: z.string().max(80).optional().nullable(),
  reraOrHoa: z.string().max(80).optional().nullable(),
  amenities: z.array(z.string()).optional(),
});

const visitSchema = z.object({
  leadId: z.string().uuid(),
  propertyId: z.string().uuid().optional().nullable(),
  startAt: z.string().min(4),
  endAt: z.string().optional().nullable(),
  type: z.enum(['site', 'video', 'phone']).optional(),
  notes: z.string().max(500).optional().nullable(),
});

const memberSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email(),
  password: z.string().min(10).optional(),
  role: z.enum(['tenant_admin', 'manager', 'agent', 'viewer']),
});

function validation() {
  const error = new Error('Check the form and try again.');
  error.status = 400;
  error.code = 'validation';
  return error;
}

function presentLead(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    source: row.source,
    sourceDetail: row.sourceDetail,
    stage: row.stage,
    priority: row.priority,
    score: row.score,
    budget: row.budget,
    need: row.need,
    propertyId: row.propertyId,
    propertyName: (row.property || row.Property)?.name || null,
    ownerUserId: row.ownerUserId,
    ownerName: (row.Owner || row.owner)?.name || null,
    followUpAt: row.followUpAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  };
}

function presentProperty(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    developer: row.developer,
    location: row.location,
    typeLabel: row.typeLabel,
    sizeRange: row.sizeRange,
    priceFrom: row.priceFrom,
    possession: row.possession,
    status: row.status,
    stageLabel: row.stageLabel,
    reraOrHoa: row.reraOrHoa,
    amenities: row.amenities || [],
  };
}

function presentVisit(row) {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: (row.lead || row.Lead)?.name || null,
    propertyId: row.propertyId,
    propertyName: (row.property || row.Property)?.name || null,
    startAt: row.startAt,
    endAt: row.endAt,
    type: row.type,
    source: row.source,
    status: row.status,
    notes: row.notes,
  };
}

export function crmController(crm, sheets) {
  return {
    async summary(req, res, next) {
      try {
        const data = await crm.summary(req.auth.tenantId);
        res.json({
          leads7d: data.leads7d,
          visits7d: data.visits7d,
          byStage: data.byStage,
          todayVisits: data.todayVisits.map(presentVisit),
          hottest: data.hottest.map(presentLead),
          due: data.due.map(presentLead),
        });
      } catch (error) {
        next(error);
      }
    },
    async listLeads(req, res, next) {
      try {
        const result = await crm.listLeads(req.auth.tenantId, req.query);
        res.json({ leads: result.rows.map(presentLead), total: result.total, page: result.page, pageSize: result.pageSize });
      } catch (error) {
        next(error);
      }
    },
    async getLead(req, res, next) {
      try {
        const result = await crm.getLead(req.auth.tenantId, req.params.id);
        res.json({
          lead: presentLead(result.lead),
          events: result.events.map((event) => ({ id: event.id, type: event.type, summary: event.summary, createdAt: event.createdAt })),
          visits: result.visits.map(presentVisit),
        });
      } catch (error) {
        next(error);
      }
    },
    async createLead(req, res, next) {
      try {
        const input = leadSchema.parse(req.body);
        const lead = await crm.createLead({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, input });
        if (sheets) await sheets.noteLead(req.auth.tenantId, lead.id);
        res.status(201).json({ lead: { id: lead.id, name: lead.name } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async updateLead(req, res, next) {
      try {
        const input = leadSchema.partial().extend({
          stage: z.enum(['new', 'talking', 'visit', 'visited', 'negotiation', 'won', 'lost']).optional(),
        }).parse(req.body);
        const lead = await crm.updateLead({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, id: req.params.id, input });
        res.json({ lead: { id: lead.id, stage: lead.stage } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async addNote(req, res, next) {
      try {
        const body = z.object({ summary: z.string().min(1).max(500) }).parse(req.body);
        await crm.addNote({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, id: req.params.id, summary: body.summary });
        res.status(201).json({ ok: true });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async archiveLead(req, res, next) {
      try {
        await crm.archiveLead({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, id: req.params.id });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    async listProperties(req, res, next) {
      try {
        const rows = await crm.listProperties(req.auth.tenantId);
        res.json({ properties: rows.map(presentProperty) });
      } catch (error) {
        next(error);
      }
    },
    async createProperty(req, res, next) {
      try {
        const input = propertySchema.parse(req.body);
        const property = await crm.createProperty({ tenantId: req.auth.tenantId, input });
        res.status(201).json({ property: presentProperty(property) });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async updateProperty(req, res, next) {
      try {
        const input = propertySchema.partial().parse(req.body);
        const property = await crm.updateProperty({ tenantId: req.auth.tenantId, id: req.params.id, input });
        res.json({ property: presentProperty(property) });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async listVisits(req, res, next) {
      try {
        const rows = await crm.listVisits(req.auth.tenantId, req.query.from, req.query.to);
        res.json({ visits: rows.map(presentVisit) });
      } catch (error) {
        next(error);
      }
    },
    async createVisit(req, res, next) {
      try {
        const input = visitSchema.parse(req.body);
        const visit = await crm.createVisit({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, input });
        res.status(201).json({ visit: { id: visit.id, startAt: visit.startAt } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async updateVisit(req, res, next) {
      try {
        const input = z.object({ status: z.enum(['booked', 'visited', 'no_show', 'rescheduled', 'cancelled']) }).parse(req.body);
        const visit = await crm.updateVisit({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, id: req.params.id, input });
        res.json({ visit: { id: visit.id, status: visit.status } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async listMembers(req, res, next) {
      try {
        const rows = await crm.listMembers(req.auth.tenantId);
        res.json({
          members: rows.map((row) => {
            const person = row.User || row.user;
            return {
              id: row.id,
              userId: row.userId,
              name: person?.name,
              email: person?.email,
              role: row.role,
            };
          }),
        });
      } catch (error) {
        next(error);
      }
    },
    async addMember(req, res, next) {
      try {
        const input = memberSchema.parse(req.body);
        const membership = await crm.addMember({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, input });
        res.status(201).json({ membership: { id: membership.id, role: membership.role } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
    async updateMemberRole(req, res, next) {
      try {
        const body = z.object({ role: z.enum(['tenant_admin', 'manager', 'agent', 'viewer']) }).parse(req.body);
        const membership = await crm.updateMemberRole({
          tenantId: req.auth.tenantId,
          actorUserId: req.auth.userId,
          membershipId: req.params.id,
          role: body.role,
        });
        res.json({ membership: { id: membership.id, role: membership.role } });
      } catch (error) {
        next(error instanceof z.ZodError ? validation(error) : error);
      }
    },
  };
}
