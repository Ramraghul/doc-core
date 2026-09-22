const pino = require('pino');
const config = require('../config/env');

// Structured JSON logs (one line per event) are what log platforms like Render expect.
// For pretty local output run `npm run dev`, which pipes through pino-pretty.
module.exports = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
