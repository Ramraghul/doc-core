const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

// Load .env for local development only. Tests must never pick up a developer's local secrets,
// and in production the platform (Render, Docker, ...) injects real environment variables.
const envFile = path.resolve(__dirname, '../../.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';
const MB = 1024 * 1024;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/docucore'),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
  USER_QUOTA_MB: z.coerce.number().positive().default(50),
  MAX_VERSIONS_PER_DOCUMENT: z.coerce.number().int().min(1).max(200).default(20),
  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  CORS_ORIGINS: z.string().default(''),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  DEMO_EMAIL: z.string().optional(),
  DEMO_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

// Empty strings in .env (e.g. `CORS_ORIGINS=`) should behave like "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
const env = parsed.data;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production.');
}

// Plain mutable object on purpose: modules read values at call time so tests can tweak limits.
module.exports = {
  env: env.NODE_ENV,
  isProd,
  isTest,
  port: env.PORT,
  mongoUri: env.MONGODB_URI,
  jwt: { secret: env.JWT_SECRET || DEV_SECRET, expiresIn: env.JWT_EXPIRES_IN, issuer: 'docucore' },
  bcryptRounds: env.BCRYPT_ROUNDS,
  maxFileBytes: Math.floor(env.MAX_FILE_SIZE_MB * MB),
  quotaBytes: Math.floor(env.USER_QUOTA_MB * MB),
  maxVersions: env.MAX_VERSIONS_PER_DOCUMENT,
  trashRetentionDays: env.TRASH_RETENTION_DAYS,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  admin: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  demo: { email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD },
  logLevel: isTest ? 'silent' : env.LOG_LEVEL,
  rateLimit: {
    enabled: !isTest,
    windowMs: 15 * 60 * 1000,
    max: 300, // requests per window per IP for the whole API
    authMax: 20, // login/register attempts per window per IP
  },
};
