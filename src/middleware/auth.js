import jwt from 'jsonwebtoken';
import { can } from '@hycin/shared';

export function requireAuth(env) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Sign in required.' } });
    }
    try {
      const payload = jwt.verify(token, env.jwt.accessSecret);
      req.auth = {
        userId: payload.sub,
        isSuperAdmin: Boolean(payload.super),
        tenantId: payload.tenantId || null,
        role: payload.role || null,
      };
      return next();
    } catch {
      return res.status(401).json({ error: { code: 'invalid_token', message: 'Sign in again.' } });
    }
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.auth?.isSuperAdmin) {
    return res.status(403).json({ error: { code: 'forbidden', message: 'Super admin only.' } });
  }
  return next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.auth?.isSuperAdmin ? 'super_admin' : req.auth?.role;
    if (!can(role, permission)) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'You cannot do that in this workspace.' } });
    }
    return next();
  };
}

export function requireActiveTenant(models) {
  return async (req, res, next) => {
    try {
      const tenant = await models.Tenant.findByPk(req.auth.tenantId);
      if (!tenant) {
        return res.status(404).json({ error: { code: 'not_found', message: 'Workspace not found.' } });
      }
      if (tenant.status !== 'active') {
        return res.status(403).json({ error: { code: 'tenant_suspended', message: 'This workspace is suspended.' } });
      }
      req.tenant = tenant;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireTenant(req, res, next) {
  if (!req.auth?.tenantId) {
    return res.status(403).json({ error: { code: 'tenant_required', message: 'This action belongs to a workspace.' } });
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'tenantId')) {
    delete req.body.tenantId;
  }
  return next();
}
