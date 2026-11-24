import IORedis from 'ioredis';

export function createRedis(env) {
  if (!env.redisUrl) return null;
  return new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

export async function redisStatus(redis) {
  if (!redis) return 'unconfigured';
  try {
    if (redis.status !== 'ready') await redis.connect();
    const reply = await redis.ping();
    return reply === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}
