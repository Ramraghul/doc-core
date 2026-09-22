const config = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Guards the unauthenticated `/internal/*` endpoints used by a scheduler (Vercel Cron, GitHub Actions,
 * any external cron) instead of a logged-in admin. Checks `Authorization: Bearer <CRON_SECRET>` — the
 * exact header Vercel Cron Jobs send automatically when the project has a `CRON_SECRET` env var set, so
 * no extra configuration is needed beyond setting that one variable.
 *
 * If CRON_SECRET is not configured, the endpoint is disabled entirely (never silently open).
 */
function requireCronSecret(req, _res, next) {
  if (!config.cronSecret) {
    throw new ApiError(503, 'CRON_NOT_CONFIGURED', 'CRON_SECRET is not set; this endpoint is disabled');
  }
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || token !== config.cronSecret) throw ApiError.unauthorized('Invalid or missing cron secret');
  next();
}

module.exports = requireCronSecret;
