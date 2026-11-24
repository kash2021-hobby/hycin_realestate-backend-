import crypto from 'node:crypto';
import { PLATFORM_KEYS } from '../database/platformDefaults.js';

export function createSettingsService({ models }) {
  const { PlatformSetting, AuditLog } = models;
  return {
    async all() {
      const rows = await PlatformSetting.findAll();
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },
    async save(key, value, actorId) {
      if (!PLATFORM_KEYS.includes(key)) {
        const error = new Error('Unknown setting.');
        error.status = 400;
        error.code = 'unknown_setting';
        throw error;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error('Setting value must be an object.');
        error.status = 400;
        error.code = 'validation';
        throw error;
      }
      const row = await PlatformSetting.findByPk(key);
      if (!row) {
        const error = new Error('Setting is not initialised.');
        error.status = 404;
        error.code = 'not_found';
        throw error;
      }
      row.value = value;
      await row.save();
      await AuditLog.create({
        id: crypto.randomUUID(),
        actorUserId: actorId,
        action: 'settings.update',
        targetType: 'platform_setting',
        targetId: key,
      });
      return row.value;
    },
  };
}
