import crypto from 'node:crypto';
import { Queue } from 'bullmq';
import { Op } from 'sequelize';
import { SHEET_HEADERS, classifySheetRows, createGoogleSheets, leadRow, publicSheetsStatus, spreadsheetIdFrom } from '../integrations/googleSheets.js';
import { normalizePhone } from './crmService.js';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function createSheetsService({ models, env, redis }) {
  const { Tenant, Lead, Property, TimelineEvent, SheetIntegration, SheetSyncEvent, PlatformSetting, sequelize } = {
    ...models,
    sequelize: models.Tenant.sequelize,
  };
  const google = createGoogleSheets(env.googleServiceAccountJson);
  const reading = new Map();
  const lastReadAt = new Map();
  let queue;
  function syncQueue() {
    if (!redis) return null;
    if (!queue) queue = new Queue('sheets-sync', { connection: redis.duplicate() });
    return queue;
  }

  async function entitled(tenantId) {
    const tenant = await Tenant.findByPk(tenantId);
    const plans = await PlatformSetting.findByPk('plans');
    const plan = (plans?.value?.items || []).find((item) => item.k === tenant?.planKey);
    if (!plan?.features?.crm) throw fail(403, 'plan_required', 'Google Sheets is on the Pro and Elite plans.');
    return tenant;
  }

  async function enqueue(event) {
    const jobs = syncQueue();
    if (!jobs) {
      event.status = 'pending';
      event.lastError = 'The sync queue is not reachable. The lead is saved.';
      await event.save();
      return;
    }
    try {
      await jobs.add('append', { eventId: event.id }, {
        jobId: `${event.id}-${event.attempts}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      });
    } catch (error) {
      event.status = 'pending';
      event.lastError = 'The sync queue did not accept the job. The lead is saved.';
      await event.save();
      console.error(`Sheets enqueue failed: ${error.message}`);
    }
  }

  async function ensureEvent(tenantId, leadId, spreadsheetId, direction) {
    const [event] = await SheetSyncEvent.findOrCreate({
      where: { tenantId, leadId, spreadsheetId },
      defaults: {
        id: crypto.randomUUID(),
        direction,
        status: direction === 'inbound' ? 'synced' : 'pending',
        attempts: 0,
      },
    });
    return event;
  }

  return {
    adminStatus() {
      return publicSheetsStatus(env.googleServiceAccountJson);
    },

    async workspace(tenantId) {
      const integration = await SheetIntegration.findByPk(tenantId);
      const events = await SheetSyncEvent.findAll({
        where: { tenantId },
        include: [{ model: Lead }],
        order: [['createdAt', 'DESC']],
        limit: 40,
      });
      const status = publicSheetsStatus(env.googleServiceAccountJson);
      const plans = await PlatformSetting.findByPk('plans');
      const tenant = await Tenant.findByPk(tenantId);
      const plan = (plans?.value?.items || []).find((item) => item.k === tenant?.planKey);
      return {
        configured: status.configured,
        serviceEmail: status.email,
        entitled: Boolean(plan?.features?.crm),
        integration: integration && integration.status !== 'off' ? {
          spreadsheetId: integration.spreadsheetId,
          title: integration.spreadsheetTitle,
          tab: integration.tabName,
          status: integration.status,
          lastError: integration.lastError,
          connectedAt: integration.connectedAt,
          lastPolledAt: integration.lastPolledAt,
        } : null,
        events: events.map((event) => ({
          id: event.id,
          leadId: event.leadId,
          leadName: event.Lead?.name || 'Lead',
          direction: event.direction,
          status: event.status,
          attempts: event.attempts,
          lastError: event.lastError,
          createdAt: event.createdAt,
        })),
      };
    },

    async connect(tenantId, spreadsheet) {
      await entitled(tenantId);
      if (!google.status.configured) {
        throw fail(503, 'sheets_unconfigured', 'Google Sheets is not configured on the server yet. Ask a super admin to add the service account.');
      }
      const spreadsheetId = spreadsheetIdFrom(spreadsheet);
      const opened = await google.open(spreadsheetId);
      const rows = await google.values(spreadsheetId, opened.tab);
      const headers = rows[0]?.length ? rows[0] : null;
      if (headers) {
        const check = classifySheetRows(rows, new Set());
        if (check.error) throw fail(400, 'validation', check.error);
      }
      const existing = await SheetIntegration.findByPk(tenantId);
      const values = {
        spreadsheetId,
        spreadsheetTitle: opened.title,
        tabName: opened.tab,
        status: 'connected',
        lastError: null,
        headers,
        connectedAt: new Date(),
      };
      const integration = existing || await SheetIntegration.create({ tenantId, ...values });
      if (existing) await integration.update(values);
      try {
        await this.importOne(integration, { force: true });
      } catch (error) {
        integration.status = 'error';
        integration.lastError = String(error.message || 'The sheet could not be read.').slice(0, 500);
        integration.lastPolledAt = new Date();
        await integration.save();
      }
      return this.workspace(tenantId);
    },

    async disconnect(tenantId) {
      const integration = await SheetIntegration.findByPk(tenantId);
      if (integration) {
        integration.status = 'off';
        await integration.save();
      }
      return this.workspace(tenantId);
    },

    async noteLead(tenantId, leadId) {
      try {
        const lead = await Lead.findOne({ where: { id: leadId, tenantId } });
        const integration = await SheetIntegration.findOne({ where: { tenantId, status: 'connected' } });
        if (!lead || !integration || lead.source === 'sheets') return;
        const event = await ensureEvent(tenantId, lead.id, integration.spreadsheetId, 'outbound');
        if (event.status === 'synced') return;
        if (event.direction !== 'outbound') return;
        await enqueue(event);
      } catch (error) {
        console.error(`Lead ${leadId} was saved. Sheets was not queued: ${error.message}`);
      }
    },

    async retry(tenantId, eventId) {
      const event = await SheetSyncEvent.findOne({ where: { id: eventId, tenantId, direction: 'outbound' } });
      if (!event) throw fail(404, 'not_found', 'Sync event not found.');
      if (event.status === 'synced') return this.workspace(tenantId);
      event.status = 'pending';
      event.lastError = null;
      await event.save();
      await enqueue(event);
      return this.workspace(tenantId);
    },

    async appendJob(eventId) {
      const event = await SheetSyncEvent.findByPk(eventId);
      if (!event || event.status === 'synced' || event.direction !== 'outbound') return;
      const integration = await SheetIntegration.findOne({ where: { tenantId: event.tenantId, status: 'connected' } });
      const lead = await Lead.findOne({ where: { id: event.leadId, tenantId: event.tenantId }, include: [{ model: Property }] });
      if (!integration || !lead) {
        event.status = 'failed';
        event.lastError = 'The sheet connection or the lead is no longer available.';
        await event.save();
        return;
      }
      if (!google.status.configured) {
        event.status = 'failed';
        event.lastError = 'Google Sheets is not configured on the server.';
        await event.save();
        return;
      }
      event.attempts += 1;
      try {
        const headers = integration.headers?.length ? integration.headers : SHEET_HEADERS;
        const rows = await google.values(integration.spreadsheetId, integration.tabName);
        const already = rows.slice(1).some((row) => String(row[0] || '') === lead.id);
        if (!already) {
          const payload = [leadRow(headers, lead, lead.Property?.name)];
          if (!rows.length) payload.unshift(headers);
          await google.append(integration.spreadsheetId, integration.tabName, payload);
          if (!integration.headers?.length) integration.headers = headers;
        }
        event.status = 'synced';
        event.lastError = null;
        integration.lastError = null;
        integration.status = 'connected';
        await integration.save();
        await event.save();
      } catch (error) {
        event.status = 'failed';
        event.lastError = String(error.message || 'Google Sheets did not accept the row.').slice(0, 500);
        integration.status = 'error';
        integration.lastError = event.lastError;
        await integration.save();
        await event.save();
        throw error;
      }
    },

    async importTenant(tenantId) {
      if (!google.status.configured) return;
      const integration = await SheetIntegration.findOne({ where: { tenantId, status: { [Op.in]: ['connected', 'error'] } } });
      if (!integration) return;
      try {
        await this.importOne(integration);
      } catch (error) {
        integration.status = 'error';
        integration.lastError = String(error.message || 'The sheet could not be read.').slice(0, 500);
        integration.lastPolledAt = new Date();
        await integration.save();
      }
    },

    async pollAll() {
      if (!google.status.configured) return;
      const integrations = await SheetIntegration.findAll({ where: { status: { [Op.in]: ['connected', 'error'] } } });
      for (const integration of integrations) {
        try {
          await this.importOne(integration);
        } catch (error) {
          integration.status = 'error';
          integration.lastError = String(error.message || 'The sheet could not be read.').slice(0, 500);
          integration.lastPolledAt = new Date();
          await integration.save();
        }
      }
    },

    async importOne(integration, options = {}) {
      const key = integration.tenantId;
      if (reading.has(key)) return reading.get(key);
      if (!options.force && Date.now() - (lastReadAt.get(key) || 0) < 4000) return;
      const job = this.readSheet(integration).finally(() => {
        lastReadAt.set(key, Date.now());
        reading.delete(key);
      });
      reading.set(key, job);
      return job;
    },

    async readSheet(integration) {
      const rows = await google.values(integration.spreadsheetId, integration.tabName);
      const known = await SheetSyncEvent.findAll({
        where: { tenantId: integration.tenantId, spreadsheetId: integration.spreadsheetId },
        attributes: ['leadId'],
      });
      const knownIds = new Set(known.map((event) => event.leadId));
      const classified = classifySheetRows(rows, knownIds);
      if (classified.error) throw fail(400, 'validation', classified.error);
      const writeBack = [];
      await sequelize.transaction(async (transaction) => {
        for (const item of classified.imported) {
          const phone = normalizePhone(item.phone);
          const email = item.email ? item.email.toLowerCase() : null;
          const sameName = (lead) => String(lead.name || '').trim().toLowerCase() === item.name.trim().toLowerCase();
          let existing = null;
          if (phone || email) {
            const candidates = await Lead.findAll({
              where: {
                tenantId: integration.tenantId,
                archivedAt: null,
                [Op.or]: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
              },
              transaction,
            });
            existing = candidates.find(sameName) || null;
          }
          if (existing) {
            const prior = await SheetSyncEvent.findOne({
              where: { tenantId: integration.tenantId, leadId: existing.id, spreadsheetId: integration.spreadsheetId },
              transaction,
            });
            if (!prior) {
              await SheetSyncEvent.create({
                id: crypto.randomUUID(),
                tenantId: integration.tenantId,
                leadId: existing.id,
                spreadsheetId: integration.spreadsheetId,
                direction: 'inbound',
                status: 'synced',
                attempts: 0,
              }, { transaction });
            }
            writeBack.push({ rowNumber: item.rowNumber, leadId: existing.id });
            continue;
          }
          const property = item.property
            ? await Property.findOne({ where: { tenantId: integration.tenantId, name: item.property }, transaction })
            : null;
          const lead = await Lead.create({
            id: crypto.randomUUID(),
            tenantId: integration.tenantId,
            name: item.name.slice(0, 160),
            phone,
            email,
            source: 'sheets',
            sourceDetail: integration.spreadsheetTitle || 'Google Sheet',
            propertyId: property?.id || null,
            budget: item.budget || null,
            need: item.need || null,
            stage: 'new',
            priority: 'normal',
            score: 0,
            lastActivityAt: new Date(),
          }, { transaction });
          await TimelineEvent.create({
            id: crypto.randomUUID(),
            tenantId: integration.tenantId,
            leadId: lead.id,
            type: 'created',
            summary: 'Lead imported from Google Sheets',
          }, { transaction });
          await SheetSyncEvent.create({
            id: crypto.randomUUID(),
            tenantId: integration.tenantId,
            leadId: lead.id,
            spreadsheetId: integration.spreadsheetId,
            direction: 'inbound',
            status: 'synced',
            attempts: 1,
          }, { transaction });
          writeBack.push({ rowNumber: item.rowNumber, leadId: lead.id });
        }
      });
      if (rows[0] && String(rows[0][0] || '').trim().toLowerCase() === 'hycin lead id') {
        for (const item of writeBack) {
          if (item.rowNumber > 1) await google.writeLeadId(integration.spreadsheetId, integration.tabName, item.rowNumber, item.leadId);
        }
      }
      integration.status = 'connected';
      integration.lastError = null;
      integration.lastPolledAt = new Date();
      if (!integration.headers?.length && rows[0]) integration.headers = rows[0];
      await integration.save();
    },
  };
}
