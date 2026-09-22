/**
 * Creates the configured admin and demo accounts (plus sample documents for the demo user).
 * Idempotent — safe to run repeatedly. The server also does this on every startup, so this script is
 * only needed for one-off seeding (e.g. `npm run seed` against a fresh Atlas cluster).
 */
const config = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { bootstrap } = require('../src/services/bootstrap');

async function main() {
  const wanted = [config.admin.email && 'admin', config.demo.email && 'demo'].filter(Boolean);
  if (!wanted.length) {
    console.log('Nothing to do: set ADMIN_EMAIL/ADMIN_PASSWORD and/or DEMO_EMAIL/DEMO_PASSWORD first.');
    return;
  }
  await connectDb();
  await bootstrap();
  console.log(`Seeded: ${wanted.join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
