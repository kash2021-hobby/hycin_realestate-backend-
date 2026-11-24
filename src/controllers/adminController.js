import { z } from 'zod';

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'validation';
  return error;
}

const createSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(80),
  market: z.enum(['IN', 'US']).optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(10),
  adminName: z.string().min(2).max(160),
});

export function adminController(tenants, models) {
  return {
    async list(req, res, next) {
      try {
        const rows = await tenants.list();
        res.json({
          tenants: rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            status: row.status,
            market: row.market,
            planKey: row.planKey,
            onboardingStep: row.onboardingStep,
          })),
        });
      } catch (error) {
        next(error);
      }
    },
    async create(req, res, next) {
      try {
        const body = createSchema.parse(req.body);
        const tenant = await tenants.create({ actorId: req.auth.userId, ...body });
        res.status(201).json({
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
        });
      } catch (error) {
        next(error instanceof z.ZodError ? invalid('Check the workspace details.') : error);
      }
    },
    async update(req, res, next) {
      try {
        const body = z.object({
          status: z.enum(['active', 'suspended']).optional(),
          planKey: z.string().max(32).nullable().optional(),
        }).parse(req.body || {});
        if (body.status == null && body.planKey === undefined) throw invalid('Choose a status or a plan.');
        let tenant = null;
        if (body.status) {
          tenant = await tenants.setStatus({ actorId: req.auth.userId, tenantId: req.params.id, status: body.status });
        }
        if (body.planKey !== undefined) {
          tenant = await tenants.setPlan({ actorId: req.auth.userId, tenantId: req.params.id, planKey: body.planKey });
        }
        res.json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, planKey: tenant.planKey } });
      } catch (error) {
        next(error instanceof z.ZodError ? invalid('Choose a status or a plan.') : error);
      }
    },
    async currentTenant(req, res, next) {
      try {
        const tenant = await models.Tenant.findByPk(req.auth.tenantId);
        if (!tenant) {
          return res.status(404).json({ error: { code: 'not_found', message: 'Workspace not found.' } });
        }
        if (tenant.status !== 'active') {
          return res.status(403).json({ error: { code: 'tenant_suspended', message: 'This workspace is suspended.' } });
        }
        return res.json({
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, market: tenant.market, status: tenant.status, planKey: tenant.planKey },
        });
      } catch (error) {
        return next(error);
      }
    },
  };
}
