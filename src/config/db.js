const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

async function connectDb(uri = config.mongoUri) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  // Fail fast (10s) instead of hanging for 30s when Atlas is unreachable or the IP is not allow-listed.
  // `runtimeAdapters`: mongodb >= 7.6 resolves OS info with a dynamic import('os'), which fails inside
  // Jest's VM sandbox and makes the server reject the handshake ("Missing required sub-document
  // 'driver'"). Passing the module explicitly is the driver's supported workaround and harmless elsewhere.
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    runtimeAdapters: { os: require('node:os') },
  });
  // Build indexes up-front so unique constraints are guaranteed before the first request.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
