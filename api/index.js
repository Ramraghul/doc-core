/**
 * Vercel serverless entrypoint. Vercel's Node.js runtime requires a file under /api that default-exports
 * a `(req, res)` handler — an Express app satisfies that signature directly, so this file is a thin
 * wrapper around the exact same `createApp()` used by src/server.js for Render/Docker/local. It only adds
 * what a serverless platform needs on top:
 *
 *  - The app and the DB connection are built/opened once per warm container and reused across
 *    invocations (module-scope, not per-request) — see src/config/db.js for the connection caching.
 *  - `bootstrap()` (admin/demo account creation) similarly runs once per cold start, not every request.
 *  - Failures in either startup step never crash the whole invocation (which would surface as Vercel's
 *    generic "FUNCTION_INVOCATION_FAILED" page); they're logged and the request still reaches Express,
 *    whose own error handling returns Docucore's normal JSON error shape instead.
 *
 * See docs/DEPLOYMENT.md#vercel for setup and this path's trade-offs versus the primary, tested Render
 * deployment (request-body size cap, execution time limit, per-container connection pooling, no
 * in-process cron — see /api/v1/internal/purge-trash and vercel.json's `crons` entry instead).
 */
const { createApp } = require('../src/app');
const { connectDb } = require('../src/config/db');
const { bootstrap } = require('../src/services/bootstrap');
const logger = require('../src/utils/logger');

const app = createApp();
let bootstrapped = null;

module.exports = async (req, res) => {
  try {
    await connectDb();
    bootstrapped ??= bootstrap().catch((err) => {
      bootstrapped = null; // let the next invocation retry instead of caching a permanent failure
      throw err;
    });
    await bootstrapped;
  } catch (err) {
    logger.error({ err }, 'Startup step failed for this invocation; degrading to per-request error handling');
  }
  return app(req, res);
};
