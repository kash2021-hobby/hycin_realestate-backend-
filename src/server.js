import { loadEnv } from './config/env.js';
import { createHttpServer } from './createServer.js';
import { redisStatus } from './queues/redis.js';

try {
  const env = loadEnv();
  const { server, redis, sheets } = await createHttpServer(env);
  server.listen(env.port, async () => {
    console.log(`HYCIN API listening on ${env.port}`);
    const state = await redisStatus(redis);
    if (state === 'up') return;
    const readSheets = () => sheets.pollAll().catch((error) => {
      console.error(`Sheet poll failed: ${error.message}`);
    });
    readSheets();
    setInterval(readSheets, 15 * 1000).unref();
  });
} catch (error) {
  console.error(`API did not start: ${error.message}`);
  process.exit(1);
}
