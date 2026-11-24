import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user, memberships) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    memberships: memberships.map((row) => {
      const workspace = row.tenants || row.tenant || row.Tenant;
      return {
        tenantId: row.tenantId,
        role: row.role,
        tenantName: workspace?.name,
        tenantSlug: workspace?.slug,
        tenantStatus: workspace?.status,
        tenantMarket: workspace?.market,
      };
    }),
  };
}

export function createAuthService({ models, env }) {
  const { User, Membership, RefreshToken, Tenant } = models;

  async function issue(user, membership) {
    const accessToken = jwt.sign(
      {
        sub: user.id,
        super: user.isSuperAdmin,
        tenantId: membership?.tenantId || null,
        role: membership?.role || (user.isSuperAdmin ? 'super_admin' : null),
      },
      env.jwt.accessSecret,
      { expiresIn: env.jwt.accessTtl },
    );
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env.jwt.refreshDays * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });
    return { accessToken, refreshToken, expiresAt };
  }

  return {
    async login({ email, password, tenantId }) {
      const user = await User.findOne({ where: { email: email.toLowerCase() } });
      const valid = user && await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        const error = new Error('Email or password is wrong.');
        error.status = 401;
        error.code = 'invalid_credentials';
        throw error;
      }
      const memberships = await Membership.findAll({
        where: { userId: user.id },
        include: [{ model: Tenant }],
      });
      let membership = null;
      if (!user.isSuperAdmin) {
        if (tenantId) {
          membership = memberships.find((row) => row.tenantId === tenantId);
          if (!membership) {
            const error = new Error('You are not a member of that workspace.');
            error.status = 403;
            error.code = 'tenant_forbidden';
            throw error;
          }
        } else if (memberships.length === 1) {
          membership = memberships[0];
        } else {
          const error = new Error('Choose a workspace.');
          error.status = 400;
          error.code = 'tenant_required';
          error.memberships = publicUser(user, memberships).memberships;
          throw error;
        }
      }
      const tokens = await issue(user, membership);
      return { ...tokens, user: publicUser(user, memberships) };
    },

    async refresh(rawToken) {
      const row = await RefreshToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
      if (!row || row.revokedAt || row.expiresAt < new Date()) {
        const error = new Error('Refresh token is not valid.');
        error.status = 401;
        error.code = 'invalid_refresh';
        throw error;
      }
      row.revokedAt = new Date();
      await row.save();
      const user = await User.findByPk(row.userId);
      const memberships = await Membership.findAll({
        where: { userId: user.id },
        include: [{ model: Tenant }],
      });
      const membership = user.isSuperAdmin ? null : memberships[0] || null;
      const tokens = await issue(user, membership);
      return { ...tokens, user: publicUser(user, memberships) };
    },

    async logout(rawToken) {
      if (!rawToken) return;
      const row = await RefreshToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
      if (row && !row.revokedAt) {
        row.revokedAt = new Date();
        await row.save();
      }
    },

    async me(userId) {
      const user = await User.findByPk(userId);
      if (!user) {
        const error = new Error('User not found.');
        error.status = 401;
        error.code = 'invalid_token';
        throw error;
      }
      const memberships = await Membership.findAll({
        where: { userId },
        include: [{ model: Tenant }],
      });
      return publicUser(user, memberships);
    },
  };
}
