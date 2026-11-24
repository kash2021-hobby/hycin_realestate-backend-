import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.string().uuid().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'validation';
  return error;
}

export function authController(auth) {
  return {
    async login(req, res, next) {
      try {
        const body = loginSchema.parse(req.body);
        res.json(await auth.login(body));
      } catch (error) {
        next(error instanceof z.ZodError ? invalid('Check the email and password.') : error);
      }
    },
    async refresh(req, res, next) {
      try {
        const body = refreshSchema.parse(req.body);
        res.json(await auth.refresh(body.refreshToken));
      } catch (error) {
        next(error instanceof z.ZodError ? invalid('Refresh token is missing.') : error);
      }
    },
    async logout(req, res, next) {
      try {
        await auth.logout(req.body?.refreshToken);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    async me(req, res, next) {
      try {
        res.json(await auth.me(req.auth.userId));
      } catch (error) {
        next(error);
      }
    },
  };
}
