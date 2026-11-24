import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ROLES } from '@hycin/shared';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createTenantService({ models }) {
  const { Tenant, User, Membership, AuditLog, PlatformSetting, sequelize } = {
    ...models,
    sequelize: models.Tenant.sequelize,
  };

  return {
    async list() {
      return Tenant.findAll({ order: [['createdAt', 'DESC']] });
    },

    async create({ actorId, name, slug, market, adminEmail, adminPassword, adminName }) {
      if (!slugPattern.test(slug)) {
        const error = new Error('Slug must be lowercase letters, numbers, and hyphens.');
        error.status = 400;
        error.code = 'invalid_slug';
        throw error;
      }
      if (!ROLES.includes('tenant_admin')) {
        throw new Error('Role catalogue is missing tenant_admin.');
      }
      if (adminPassword.length < 10) {
        const error = new Error('The workspace admin password must be at least 10 characters.');
        error.status = 400;
        error.code = 'weak_password';
        throw error;
      }

      return sequelize.transaction(async (transaction) => {
        const taken = await Tenant.findOne({ where: { slug }, transaction });
        if (taken) {
          const error = new Error('That site slug is already used.');
          error.status = 409;
          error.code = 'slug_taken';
          throw error;
        }
        const tenant = await Tenant.create({
          id: crypto.randomUUID(),
          name,
          slug,
          market: market === 'US' ? 'US' : 'IN',
          status: 'active',
          onboardingStep: 'O2',
        }, { transaction });

        let user = await User.findOne({ where: { email: adminEmail.toLowerCase() }, transaction });
        if (!user) {
          user = await User.create({
            id: crypto.randomUUID(),
            email: adminEmail.toLowerCase(),
            passwordHash: await bcrypt.hash(adminPassword, 12),
            name: adminName,
            isSuperAdmin: false,
          }, { transaction });
        }
        const existing = await Membership.findOne({
          where: { tenantId: tenant.id, userId: user.id },
          transaction,
        });
        if (!existing) {
          await Membership.create({
            id: crypto.randomUUID(),
            tenantId: tenant.id,
            userId: user.id,
            role: 'tenant_admin',
          }, { transaction });
        }
        await AuditLog.create({
          id: crypto.randomUUID(),
          actorUserId: actorId,
          tenantId: tenant.id,
          action: 'tenant.create',
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { slug },
        }, { transaction });
        return tenant;
      });
    },

    async updateProfile({ userId, tenantId, name, brand, phone, onboardingStep }) {
      const user = await User.findByPk(userId);
      const tenant = await Tenant.findByPk(tenantId);
      if (!user || !tenant) {
        const error = new Error('Workspace not found.');
        error.status = 404;
        error.code = 'not_found';
        throw error;
      }
      if (name != null) user.name = String(name).trim().slice(0, 160);
      if (brand != null) tenant.brand = String(brand).trim().slice(0, 160) || null;
      if (phone != null) tenant.phone = String(phone).trim().slice(0, 32) || null;
      if (onboardingStep != null) tenant.onboardingStep = onboardingStep;
      await user.save();
      await tenant.save();
      return { name: user.name, brand: tenant.brand, phone: tenant.phone, onboardingStep: tenant.onboardingStep };
    },

    async setStatus({ actorId, tenantId, status }) {
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) {
        const error = new Error('Workspace not found.');
        error.status = 404;
        error.code = 'not_found';
        throw error;
      }
      await sequelize.transaction(async (transaction) => {
        tenant.status = status;
        await tenant.save({ transaction });
        await AuditLog.create({
          id: crypto.randomUUID(),
          actorUserId: actorId,
          tenantId: tenant.id,
          action: status === 'suspended' ? 'tenant.suspend' : 'tenant.reactivate',
          targetType: 'tenant',
          targetId: tenant.id,
        }, { transaction });
      });
      return tenant;
    },

    async setPlan({ actorId, tenantId, planKey }) {
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) {
        const error = new Error('Workspace not found.');
        error.status = 404;
        error.code = 'not_found';
        throw error;
      }
      const key = planKey ? String(planKey) : null;
      if (key) {
        const plans = await PlatformSetting.findByPk('plans');
        const known = (plans?.value?.items || []).some((item) => item.k === key);
        if (!known) {
          const error = new Error('Choose a plan from the catalog.');
          error.status = 400;
          error.code = 'validation';
          throw error;
        }
      }
      await sequelize.transaction(async (transaction) => {
        tenant.planKey = key;
        await tenant.save({ transaction });
        await AuditLog.create({
          id: crypto.randomUUID(),
          actorUserId: actorId,
          tenantId: tenant.id,
          action: 'tenant.plan',
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { planKey: key },
        }, { transaction });
      });
      return tenant;
    },
  };
}
