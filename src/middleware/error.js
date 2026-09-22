const mongoose = require('mongoose');
const multer = require('multer');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

/** Translate library errors into our ApiError shape so every failure has one consistent format. */
function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return ApiError.tooLarge(`File exceeds the maximum size of ${Math.round(config.maxFileBytes / 1024 / 1024 * 10) / 10} MB`, 'FILE_TOO_LARGE');
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return ApiError.badRequest('Unexpected file field; use the field name "file"', 'UNEXPECTED_FILE_FIELD');
    }
    return ApiError.badRequest(err.message, 'UPLOAD_ERROR');
  }

  // body-parser errors carry a `type`
  if (err.type === 'entity.parse.failed') return ApiError.badRequest('Request body is not valid JSON', 'INVALID_JSON');
  if (err.type === 'entity.too.large') return ApiError.tooLarge('Request body is too large');

  if (err instanceof mongoose.Error.CastError) return ApiError.badRequest(`Invalid value for "${err.path}"`, 'INVALID_ID');
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return ApiError.validation(details);
  }
  if (err.code === 11000) return ApiError.conflict('Resource already exists', 'DUPLICATE');

  return null;
}

function errorHandler(err, req, res, _next) {
  const apiError = normalize(err);

  if (!apiError) {
    // Unknown failure: log everything server-side, reveal nothing to the client.
    (req.log || logger).error({ err }, 'Unhandled error');
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side', requestId: req.id },
    });
  }

  if (apiError.status >= 500) (req.log || logger).error({ err }, apiError.message);
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      requestId: req.id,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
