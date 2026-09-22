const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

/**
 * Verifies the `Authorization: Bearer <jwt>` header and loads the user.
 * We hit the database on every request (one indexed lookup) instead of trusting the token alone,
 * so deleting a user or changing their role takes effect immediately rather than at token expiry.
 */
async function authenticate(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Token has expired', 'TOKEN_EXPIRED');
    throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }

  if (!mongoose.isValidObjectId(payload.sub)) throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists', 'INVALID_TOKEN');

  req.user = { id: String(user._id), role: user.role, name: user.name, email: user.email };
  next();
}

const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role) ? next() : next(ApiError.forbidden('Administrator access required'));

module.exports = { authenticate, requireRole };
