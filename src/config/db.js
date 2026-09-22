const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

// Cache the in-flight/completed connection attempt so concurrent callers (e.g. several serverless
// invocations hitting a warm container at once) share one connection instead of racing to open several.
// A long-running process (Render/Docker/local) only ever calls connectDb() once anyway, so this is a
// no-op improvement there; on Vercel it is what makes reusing one connection per container work at all.
let connectingPromise = null;
let listenersAttached = false;

async function connectDb(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return; // already connected (e.g. warm serverless container)

  if (!listenersAttached) {
    listenersAttached = true;
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  }

  if (!connectingPromise) {
    connectingPromise = (async () => {
      // Fail fast (10s) instead of hanging for 30s when Atlas is unreachable or the IP is not allow-listed.
      // `runtimeAdapters`: mongodb >= 7.6 resolves OS info with a dynamic import('os'), which fails inside
      // Jest's VM sandbox and makes the server reject the handshake ("Missing required sub-document
      // 'driver'"). Passing the module explicitly is the driver's supported workaround and harmless elsewhere.
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10_000,
        runtimeAdapters: { os: require('node:os') },
        // On serverless, many container instances can each open their own pool; keep pools small so a
        // burst of concurrent invocations can't exhaust Atlas M0's 500-connection cap. A long-running
        // single process (Render/Docker/local) keeps Mongoose's normal default pool size.
        ...(config.isServerless ? { maxPoolSize: 5, minPoolSize: 0 } : {}),
      });
      // Build indexes up-front so unique constraints are guaranteed before the first request.
      await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    })().catch((err) => {
      connectingPromise = null; // let the next call retry instead of replaying a stale rejection forever
      throw err;
    });
  }
  return connectingPromise;
}

async function disconnectDb() {
  connectingPromise = null;
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
