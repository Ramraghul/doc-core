const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const passthrough = (_req, _res, next) => next();

const build = (limit, message) =>
  config.rateLimit.enabled
    ? rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', message)),
      })
    : passthrough;

// Built when the app is created (not at import time) so tests can flip the config first.
const apiLimiter = () => build(config.rateLimit.max, 'Too many requests, please slow down');
const authLimiter = () =>
  build(config.rateLimit.authMax, 'Too many login/registration attempts, please try again later');

module.exports = { apiLimiter, authLimiter };
