const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { apiLimiter, authLimiter } = require('../middleware/rateLimit');
const requireCronSecret = require('../middleware/cronAuth');
const config = require('../config/env');
const { ALLOWED_MIME_TYPES } = require('../utils/fileTypes');
const { purgeExpiredTrash } = require('../services/documentService');

/** Built by a function (not exported as a constant) so rate limiters pick up the config at app-creation time. */
function buildApiRouter() {
  const router = Router();

  router.use(apiLimiter());
  // Credential endpoints get a much tighter limit to slow down password guessing / mass sign-up.
  router.use(['/auth/login', '/auth/register'], authLimiter());

  // Public, non-sensitive settings the web UI needs (limits, and the optional demo login for portfolio visitors).
  router.get('/config', (_req, res) => {
    const { email, password } = config.demo;
    res.json({
      maxFileBytes: config.maxFileBytes,
      userQuotaBytes: config.quotaBytes,
      maxVersionsPerDocument: config.maxVersions,
      trashRetentionDays: config.trashRetentionDays,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      demo: email && password ? { email, password } : null,
    });
  });

  router.use('/auth', require('./auth.routes'));
  router.use('/public', require('./public.routes'));
  router.use('/documents', authenticate, require('./documents.routes'));
  router.use('/admin', authenticate, requireRole('admin'), require('./admin.routes'));

  // For schedulers, not people: no serverless platform runs a persistent process, so there is nowhere
  // for the in-process trash-purge timer (src/server.js) to live between invocations there. GET (not
  // POST) because Vercel Cron Jobs only ever send GET. Guarded by requireCronSecret, never a user JWT.
  router.get('/internal/purge-trash', requireCronSecret, async (_req, res) => {
    res.json({ purged: await purgeExpiredTrash() });
  });

  return router;
}

module.exports = buildApiRouter;
