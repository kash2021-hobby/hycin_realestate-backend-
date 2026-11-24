import { z } from 'zod';

const connectSchema = z.object({
  spreadsheet: z.string().trim().min(10).max(500),
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error('Paste a Google Sheet link or the spreadsheet id.');
    error.status = 400;
    error.code = 'validation';
    throw error;
  }
  return result.data;
}

export function sheetsController(sheets) {
  return {
    async admin(req, res, next) {
      try {
        res.json({ googleSheets: sheets.adminStatus() });
      } catch (error) {
        next(error);
      }
    },
    async workspace(req, res, next) {
      try {
        res.json({ googleSheets: await sheets.workspace(req.auth.tenantId) });
      } catch (error) {
        next(error);
      }
    },
    async connect(req, res, next) {
      try {
        const body = parse(connectSchema, req.body || {});
        res.json({ googleSheets: await sheets.connect(req.auth.tenantId, body.spreadsheet) });
      } catch (error) {
        next(error);
      }
    },
    async disconnect(req, res, next) {
      try {
        res.json({ googleSheets: await sheets.disconnect(req.auth.tenantId) });
      } catch (error) {
        next(error);
      }
    },
    async history(req, res, next) {
      try {
        const page = await sheets.workspace(req.auth.tenantId);
        res.json({ events: page.events });
      } catch (error) {
        next(error);
      }
    },
    async retry(req, res, next) {
      try {
        res.json({ googleSheets: await sheets.retry(req.auth.tenantId, req.params.id) });
      } catch (error) {
        next(error);
      }
    },
  };
}
