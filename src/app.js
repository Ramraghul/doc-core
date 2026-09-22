const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');

const config = require('./config/env');
const logger = require('./utils/logger');
const buildApiRouter = require('./routes');
const { docsRouter } = require('./docs/swagger');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { version } = require('../package.json');

const publicDir = path.join(__dirname, '..', 'public');

/** A caller-supplied request id is honoured only if it is short and boring; otherwise we mint one. */
function genReqId(req, res) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Render/Fly/Heroku terminate TLS in a proxy; without this every client looks like one IP and
  // rate limiting would throttle all users together.
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId,
      autoLogging: { ignore: (req) => req.url === '/health' }, // uptime pings would drown the logs
      // Compact one-line access logs: no header dump (also keeps tokens/cookies out of the logs).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  app.use(
    helmet({
      // Plain-http localhost must not be force-upgraded to https (breaks local dev in some browsers).
      contentSecurityPolicy: { useDefaults: true, directives: config.isProd ? {} : { 'upgrade-insecure-requests': null } },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : false, // default: same-origin only
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));

  // Liveness + readiness in one: also pings MongoDB, so an uptime monitor hitting this URL keeps the
  // Render instance awake AND counts as activity that stops Atlas auto-pausing an idle free cluster.
  app.get('/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const base = { version, uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db.admin().ping();
      res.json({ status: 'ok', db: 'up', ...base });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down', ...base });
    }
  });

  app.use(docsRouter());
  app.use(express.static(publicDir, { maxAge: config.isProd ? '1h' : 0 }));
  app.use('/api/v1', buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
