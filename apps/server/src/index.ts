import { createApp } from './app';
import { prisma } from './db';
import { env } from './env';
import { log } from './lib/log';

const app = createApp();
const server = app.listen(env.port, () => {
  log.info(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
