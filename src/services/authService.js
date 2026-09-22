const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(user._id),
    issuer: config.jwt.issuer,
    expiresIn: config.jwt.expiresIn,
  });
}

async function register({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    user = await User.create({ name, email, passwordHash });
  } catch (err) {
    // The unique index (not a "find first" check) is what makes this race-free.
    if (err.code === 11000) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    throw err;
  }
  return { user, token: signToken(user) };
}

// Compared against when the email is unknown, so "no such user" and "wrong password" take the same
// time and cannot be told apart by measuring response latency.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('not-a-real-password', config.bcryptRounds));

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await bcrypt.compare(password, user ? user.passwordHash : getDummyHash());
  if (!user || !valid) throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  return { user, token: signToken(user) };
}

module.exports = { register, login, signToken };
