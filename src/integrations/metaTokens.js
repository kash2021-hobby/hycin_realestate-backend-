import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(secret) {
  if (!secret) {
    const error = new Error('META_TOKEN_ENCRYPTION_KEY is not set.');
    error.status = 503;
    error.code = 'not_configured';
    throw error;
  }
  return createHash('sha256').update(`${secret}:meta`).digest();
}

export function sealMetaToken(secret, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
}

export function openMetaToken(secret, packed) {
  const [iv, tag, data] = String(packed || '').split('.');
  if (!iv || !tag || !data) throw new Error('Stored Meta credential is unreadable.');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
