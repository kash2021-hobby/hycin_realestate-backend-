import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(root, '.env') });

export function firstOrigin(value) {
  const origin = Array.isArray(value) ? value[0] : value;
  return String(origin || '').replace(/\/$/, '');
}

function corsOrigins() {
  const listed = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean);
  if ((process.env.NODE_ENV || 'development') === 'production') return listed.length === 1 ? listed[0] : listed;
  return [...new Set([...listed, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8081', 'http://127.0.0.1:8081'])];
}

function required(name, alias) {
  const value = process.env[name] || (alias ? process.env[alias] : '');
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.`);
  }
  return value;
}

export function loadEnv() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    corsOrigin: corsOrigins(),
    mysql: {
      host: required('MYSQL_HOST', 'DB_HOST'),
      port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
      user: required('MYSQL_USER', 'DB_USER'),
      password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASS ?? '',
      database: required('MYSQL_DATABASE', 'DB_NAME'),
    },
    redisUrl: process.env.REDIS_URL || '',
    jwt: {
      accessSecret: required('JWT_ACCESS_SECRET'),
      refreshSecret: required('JWT_REFRESH_SECRET'),
      accessTtl: process.env.JWT_ACCESS_TTL || '15m',
      refreshDays: Number(process.env.JWT_REFRESH_DAYS || 30),
    },
    googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    meta: {
      appId: process.env.META_APP_ID || '',
      appSecret: process.env.META_APP_SECRET || '',
      verifyToken: process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || '',
      graphVersion: process.env.META_GRAPH_API_VERSION || 'v21.0',
      embeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '',
      redirectUri: process.env.META_REDIRECT_URI || '',
      tokenEncryptionKey: process.env.META_TOKEN_ENCRYPTION_KEY || '',
    },
    telegramAlertToken: process.env.TELEGRAM_ALERT_BOT_TOKEN || '',
    googleOauth: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    },
    superAdmin: {
      email: required('SUPER_ADMIN_EMAIL').toLowerCase(),
      password: required('SUPER_ADMIN_PASSWORD'),
      name: process.env.SUPER_ADMIN_NAME || 'HYCIN Admin',
    },
  };
}
