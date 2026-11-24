export function inboxController(inbox) {
  return {
    async connections(req, res, next) {
      try {
        res.json({ connections: await inbox.listConnections(req.auth.tenantId), bot: 'disabled' });
      } catch (error) {
        next(error);
      }
    },
    async connectTelegram(req, res, next) {
      try {
        res.json({ connection: await inbox.connectTelegram(req.auth.tenantId, req.body?.botToken) });
      } catch (error) {
        next(error);
      }
    },
    async connectWhatsapp(req, res, next) {
      try {
        res.json({ connection: await inbox.connectWhatsapp(req.auth.tenantId, req.body?.accessToken, req.body?.phoneNumberId) });
      } catch (error) {
        next(error);
      }
    },
    async oauthUrl(req, res, next) {
      try {
        res.json(await inbox.oauthUrl(req.auth.tenantId, req.auth.userId, req.params.platform));
      } catch (error) {
        next(error);
      }
    },
    async oauthCallback(req, res, next) {
      try {
        const nextUrl = await inbox.oauthCallback(String(req.query.code || ''), String(req.query.state || ''));
        res.redirect(nextUrl);
      } catch (error) {
        next(error);
      }
    },
    async disconnect(req, res, next) {
      try {
        res.json({ connection: await inbox.disconnect(req.auth.tenantId, req.params.platform) });
      } catch (error) {
        next(error);
      }
    },
    async list(req, res, next) {
      try {
        res.json(await inbox.list(req.auth.tenantId, req.query.filter));
      } catch (error) {
        next(error);
      }
    },
    async get(req, res, next) {
      try {
        res.json(await inbox.getThread(req.auth.tenantId, req.params.id));
      } catch (error) {
        next(error);
      }
    },
    async create(req, res, next) {
      try {
        res.status(201).json(await inbox.logThread(req.auth.tenantId, req.body || {}));
      } catch (error) {
        next(error);
      }
    },
    async message(req, res, next) {
      try {
        res.status(201).json(await inbox.addMessage(req.auth.tenantId, req.auth.userId, req.params.id, req.body?.body));
      } catch (error) {
        next(error);
      }
    },
    async patch(req, res, next) {
      try {
        res.json(await inbox.patchThread(req.auth.tenantId, req.auth.userId, req.params.id, req.body || {}));
      } catch (error) {
        next(error);
      }
    },
    async notifications(req, res, next) {
      try {
        res.json(await inbox.listNotifications(req.auth.tenantId));
      } catch (error) {
        next(error);
      }
    },
    async readNotification(req, res, next) {
      try {
        res.json(await inbox.markRead(req.auth.tenantId, req.params.id));
      } catch (error) {
        next(error);
      }
    },
    async metaVerify(req, res, next) {
      try {
        res.status(200).type('text/plain').send(inbox.verifyMetaChallenge(req.query));
      } catch (error) {
        next(error);
      }
    },
    async meta(req, res, next) {
      try {
        const accepted = await inbox.acceptMeta(req.rawBody, req.get('x-hub-signature-256'));
        res.status(200).json({ ok: true, duplicate: accepted.duplicate });
        if (!accepted.duplicate) inbox.enqueue(accepted.event.id).catch((error) => console.error(error.message));
      } catch (error) {
        next(error);
      }
    },
    async telegram(req, res, next) {
      try {
        const accepted = await inbox.acceptTelegram(req.params.tenantId, req.get('x-telegram-bot-api-secret-token'), req.body);
        res.status(200).json({ ok: true, duplicate: accepted.duplicate });
        if (!accepted.duplicate) inbox.enqueue(accepted.event.id).catch((error) => console.error(error.message));
      } catch (error) {
        next(error);
      }
    },
  };
}
