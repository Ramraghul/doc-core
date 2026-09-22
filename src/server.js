const config = require('./config/env');
const logger = require('./utils/logger');
const { connectDb, disconnectDb } = require('./config/db');
const { createApp } = require('./app');
const { bootstrap } = require('./services/bootstrap');
const { purgeExpiredTrash } = require('./services/documentService');

const SIX_HOURS = 6 * 60 * 60 * 1000;

async function main() {
  await connectDb();
  logger.info('Connected to MongoDB');
  await bootstrap();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Docucore listening on :${config.port} (${config.env}) — docs at /api-docs`);
  });

  // Housekeeping while the instance is awake. (Free hosts sleep when idle, so this is best-effort;
  // POST /api/v1/admin/purge-trash can also be triggered by a scheduler.)
  const purgeTimer = setInterval(async () => {
    try {
      const purged = await purgeExpiredTrash();
      if (purged) logger.info({ purged }, 'Purged expired trash');
    } catch (err) {
      logger.error({ err }, 'Trash purge failed');
    }
  }, SIX_HOURS);
  purgeTimer.unref();

  // Graceful shutdown: platforms send SIGTERM on every deploy/scale-down. Stop accepting new
  // connections, let in-flight requests (e.g. an upload) finish, then close the DB.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await disconnectDb().catch(() => {});
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled promise rejection');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
