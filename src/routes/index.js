import { Router } from 'express';
import { z } from 'zod';
import { requireActiveTenant, requireAuth, requirePermission, requireSuperAdmin, requireTenant } from '../middleware/auth.js';
import { crmController } from '../controllers/crmController.js';
import { authController } from '../controllers/authController.js';
import { adminController } from '../controllers/adminController.js';
import { siteController } from '../controllers/siteController.js';
import { sheetsController } from '../controllers/sheetsController.js';
import { inboxController } from '../controllers/inboxController.js';
import { adminMetaStatus, publicMetaConfig } from '../integrations/metaConfig.js';

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'validation';
  return error;
}

export function apiRouter({ auth, tenants, settings, crm, site, sheets, inbox, alerts, meta, models, env }) {
  const router = Router();
  const authHandlers = authController(auth);
  const admin = adminController(tenants, models);
  const desk = crmController(crm, sheets);
  const pages = siteController(site, sheets);
  const sheetHandlers = sheetsController(sheets);
  const inboxHandlers = inboxController(inbox);
  const signedIn = requireAuth(env);
  const workspace = [signedIn, requireTenant, requireActiveTenant(models)];
  const view = [...workspace, requirePermission('workspace.view')];
  const write = [...workspace, requirePermission('workspace.write')];
  const manage = [...workspace, requirePermission('workspace.admin')];

  router.get('/catalog', async (req, res, next) => {
    try {
      const all = await settings.all();
      res.json({
        plans: all.plans || { items: [] },
        services: all.services || { items: [] },
        packages: all.packages || { items: [] },
        themes: all.themes || { items: [] },
        credits: { costs: all.credits?.costs || [] },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/auth/login', authHandlers.login);
  router.post('/auth/refresh', authHandlers.refresh);
  router.post('/auth/logout', authHandlers.logout);
  router.get('/me', signedIn, authHandlers.me);
  router.get('/tenant', signedIn, requireTenant, admin.currentTenant);
  router.patch('/workspace/plan', ...manage, async (req, res, next) => {
    try {
      const body = z.object({ planKey: z.string().min(1).max(32) }).parse(req.body || {});
      const tenant = await tenants.setPlan({ actorId: req.auth.userId, tenantId: req.auth.tenantId, planKey: body.planKey });
      res.json({ planKey: tenant.planKey });
    } catch (error) {
      next(error instanceof z.ZodError ? invalid('Choose a plan from the catalog.') : error);
    }
  });
  router.patch('/workspace', ...write, async (req, res, next) => {
    try {
      const body = z.object({
        name: z.string().min(2).max(160).optional(),
        brand: z.string().max(160).optional(),
        phone: z.string().max(32).optional(),
        onboardingStep: z.enum(['O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'done']).optional(),
      }).parse(req.body || {});
      res.json({
        profile: await tenants.updateProfile({ userId: req.auth.userId, tenantId: req.auth.tenantId, ...body }),
      });
    } catch (error) {
      next(error instanceof z.ZodError ? invalid('Check the form and try again.') : error);
    }
  });
  router.get('/summary', ...view, desk.summary);
  router.get('/leads', ...view, async (req, res, next) => {
    try {
      await Promise.race([
        sheets.importTenant(req.auth.tenantId),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (error) {
      console.error(`Sheet read skipped: ${error.message}`);
    }
    return desk.listLeads(req, res, next);
  });
  router.post('/leads', ...write, desk.createLead);
  router.get('/leads/:id', ...view, desk.getLead);
  router.patch('/leads/:id', ...write, desk.updateLead);
  router.post('/leads/:id/notes', ...write, desk.addNote);
  router.delete('/leads/:id', ...write, desk.archiveLead);
  router.get('/properties', ...view, desk.listProperties);
  router.post('/properties', ...write, desk.createProperty);
  router.patch('/properties/:id', ...write, desk.updateProperty);
  router.get('/visits', ...view, desk.listVisits);
  router.post('/visits', ...write, desk.createVisit);
  router.patch('/visits/:id', ...write, desk.updateVisit);
  router.get('/members', ...view, desk.listMembers);
  router.post('/members', ...manage, desk.addMember);
  router.patch('/members/:id', ...manage, desk.updateMemberRole);
  router.get('/site/analytics', ...view, pages.analytics);
  router.get('/site', ...view, pages.get);
  router.patch('/site', ...write, pages.update);
  router.post('/site/publish', ...write, pages.publish);
  router.get('/public/sites/:slug/properties/:propertySlug', pages.publicProperty);
  router.get('/public/sites/:slug/slots', pages.slots);
  router.post('/public/sites/:slug/book', pages.book);
  router.get('/public/sites/:slug', pages.publicSite);
  router.post('/public/events', pages.event);
  router.post('/e', pages.event);
  router.get('/webhooks/meta', inboxHandlers.metaVerify);
  router.post('/webhooks/meta', inboxHandlers.meta);
  router.post('/webhooks/telegram/:tenantId', inboxHandlers.telegram);
  router.get('/connections/oauth/callback', inboxHandlers.oauthCallback);
  router.get('/meta', ...view, async (req, res, next) => {
    try {
      const workspace = await meta.workspace(req.auth.tenantId);
      res.json({ meta: { ...publicMetaConfig(env.meta), ...workspace } });
    } catch (error) {
      next(error);
    }
  });
  router.get('/admin/meta', signedIn, requireSuperAdmin, (req, res) => {
    res.json({ meta: adminMetaStatus(env.meta) });
  });
  router.get('/connections', ...view, inboxHandlers.connections);
  router.post('/connections/telegram', ...write, inboxHandlers.connectTelegram);
  router.post('/connections/whatsapp', ...write, inboxHandlers.connectWhatsapp);
  router.get('/connections/:platform/oauth-url', ...write, inboxHandlers.oauthUrl);
  router.delete('/connections/:platform', ...write, inboxHandlers.disconnect);
  router.get('/threads', ...view, inboxHandlers.list);
  router.post('/threads', ...write, inboxHandlers.create);
  router.get('/threads/:id', ...view, inboxHandlers.get);
  router.post('/threads/:id/messages', ...write, inboxHandlers.message);
  router.patch('/threads/:id', ...write, inboxHandlers.patch);
  router.get('/alerts', ...view, async (req, res, next) => {
    try {
      res.json({ alerts: await alerts.get(req.auth.tenantId) });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/alerts', ...write, async (req, res, next) => {
    try {
      const body = z.object({ chatId: z.string().max(32).optional() }).parse(req.body || {});
      res.json({ alerts: await alerts.setChat(req.auth.tenantId, body.chatId) });
    } catch (error) {
      next(error instanceof z.ZodError ? invalid('Check the form and try again.') : error);
    }
  });
  router.get('/reply-policy', ...view, async (req, res, next) => {
    try {
      res.json({ policy: await alerts.policy(req.auth.tenantId) });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/reply-policy', ...write, async (req, res, next) => {
    try {
      const policy = await alerts.savePolicy(req.auth.tenantId, req.body || {});
      res.json({ policy });
    } catch (error) {
      next(error);
    }
  });
  router.post('/reply-policy/test', ...write, (req, res) => {
    res.status(503).json({ error: { code: 'bot_disabled', message: 'HYCIN is not answering yet. This test did not call a model or a channel.' } });
  });
  router.get('/notifications', ...view, inboxHandlers.notifications);
  router.post('/notifications/:id/read', ...write, inboxHandlers.readNotification);
  router.get('/admin/integrations/google-sheets', signedIn, requireSuperAdmin, sheetHandlers.admin);
  router.get('/tenant/integrations/google-sheets/sync-events', ...view, sheetHandlers.history);
  router.post('/tenant/integrations/google-sheets/sync-events/:id/retry', ...write, sheetHandlers.retry);
  router.get('/tenant/integrations/google-sheets', ...view, sheetHandlers.workspace);
  router.put('/tenant/integrations/google-sheets', ...write, sheetHandlers.connect);
  router.delete('/tenant/integrations/google-sheets', ...write, sheetHandlers.disconnect);
  router.get('/admin/tenants', signedIn, requireSuperAdmin, admin.list);
  router.post('/admin/tenants', signedIn, requireSuperAdmin, admin.create);
  router.patch('/admin/tenants/:id', signedIn, requireSuperAdmin, admin.update);
  router.get('/admin/settings', signedIn, requireSuperAdmin, async (req, res, next) => {
    try {
      res.json({ settings: await settings.all() });
    } catch (error) {
      next(error);
    }
  });
  router.put('/admin/settings/:key', signedIn, requireSuperAdmin, async (req, res, next) => {
    try {
      const value = await settings.save(req.params.key, req.body?.value, req.auth.userId);
      res.json({ key: req.params.key, value });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
