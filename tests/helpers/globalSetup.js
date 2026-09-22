const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * One throw-away MongoDB for the whole test run (started once, shared by all Jest workers).
 * Each worker uses its own database name (see env.js), so test files never see each other's data.
 * Set MONGOMS_SYSTEM_BINARY=/usr/bin/mongod to reuse an installed mongod instead of downloading one.
 */
module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.TEST_MONGO_URI = mongod.getUri();
  globalThis.__MONGOD__ = mongod;
};
