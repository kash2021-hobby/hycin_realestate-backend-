import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { Umzug, SequelizeStorage } from 'umzug';
import { createSequelize } from './sequelize.js';
import { defineModels } from './models.js';
import { PLATFORM_KEYS, platformDefaults } from './platformDefaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function initDatabase(env) {
  const admin = await mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
  });
  try {
    const name = env.mysql.database.replace(/[^a-zA-Z0-9_]/g, '');
    if (!name || name !== env.mysql.database) {
      throw new Error('MYSQL_DATABASE may contain only letters, numbers, and underscores.');
    }
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }

  const sequelize = createSequelize(env);
  try {
    await sequelize.authenticate();
  } catch (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }

  const umzug = new Umzug({
    migrations: { glob: ['migrations/*.js', { cwd: path.join(here, '..') }] },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });
  await umzug.up();

  const models = defineModels(sequelize);
  await seedSuperAdmin(models, env);
  await seedPlatformSettings(models);
  return { sequelize, models };
}

async function seedPlatformSettings(models) {
  for (const key of PLATFORM_KEYS) {
    const existing = await models.PlatformSetting.findByPk(key);
    if (!existing) {
      await models.PlatformSetting.create({ key, value: platformDefaults[key] });
    }
  }
}

async function seedSuperAdmin(models, env) {
  const existing = await models.User.findOne({ where: { email: env.superAdmin.email } });
  if (existing) return;
  if (env.superAdmin.password.length < 10) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 10 characters.');
  }
  await models.User.create({
    id: crypto.randomUUID(),
    email: env.superAdmin.email,
    passwordHash: await bcrypt.hash(env.superAdmin.password, 12),
    name: env.superAdmin.name,
    isSuperAdmin: true,
  });
  console.log(`Seeded super admin ${env.superAdmin.email}`);
}
