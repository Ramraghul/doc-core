const mongoose = require('mongoose');
const SwaggerParser = require('@apidevtools/swagger-parser');
const config = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { spec } = require('../../src/docs/swagger');
const User = require('../../src/models/User');
const { setup, teardown, clearDb, request } = require('../helpers/testkit');

let app;
beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(clearDb);
afterEach(() => jest.restoreAllMocks());

describe('System: health, errors, security headers', () => {
  it('SYS-01 /health reports ok and pings the database', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up', version: '1.0.0' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('SYS-02 /health returns 503 (degraded) when the database is unreachable', async () => {
    jest.spyOn(mongoose.connection.db, 'admin').mockReturnValue({ ping: () => Promise.reject(new Error('down')) });
    const res = await request(app).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('SYS-03 unknown routes return a JSON 404 with code ROUTE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    await request(app).post('/definitely/not/here').expect(404);
  });

  it('SYS-04 every response carries X-Request-Id, echoed in error bodies; hostile ids are replaced', async () => {
    const generated = await request(app).get('/api/v1/nope').expect(404);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.error.requestId).toBe(generated.headers['x-request-id']);

    const mine = 'trace-abc-12345678';
    const echoed = await request(app).get('/api/v1/nope').set('X-Request-Id', mine).expect(404);
    expect(echoed.headers['x-request-id']).toBe(mine);

    const hostile = await request(app).get('/api/v1/nope').set('X-Request-Id', 'a b<script>').expect(404);
    expect(hostile.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('SYS-05 sets hardened security headers and hides the framework', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('SYS-06 unexpected errors return a generic 500 and never leak internals', async () => {
    jest.spyOn(User, 'findOne').mockImplementation(() => { throw new Error('SECRET connection string mongodb://user:pw@host'); });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'Passw0rd1' }).expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|mongodb:\/\//);
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('SYS-07 CORS is same-origin only by default and allow-lists configured origins', async () => {
    const closed = await request(app).get('/health').set('Origin', 'https://evil.example').expect(200);
    expect(closed.headers['access-control-allow-origin']).toBeUndefined();

    const original = config.corsOrigins;
    config.corsOrigins = ['https://portfolio.example'];
    try {
      const open = createApp();
      const ok = await request(open).get('/health').set('Origin', 'https://portfolio.example').expect(200);
      expect(ok.headers['access-control-allow-origin']).toBe('https://portfolio.example');
      const denied = await request(open).get('/health').set('Origin', 'https://evil.example').expect(200);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      config.corsOrigins = original;
    }
  });
});

describe('System: rate limiting', () => {
  it('SYS-10 throttles repeated login attempts per IP (429 RATE_LIMITED) while other routes stay available', async () => {
    const original = { ...config.rateLimit };
    Object.assign(config.rateLimit, { enabled: true, authMax: 3, max: 1000 });
    try {
      const limited = createApp(); // limiters are created with the app, so they pick up the config above
      const attempt = () => request(limited).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'WrongPass1' });
      for (let i = 0; i < 3; i += 1) await attempt().expect(401);
      const blocked = await attempt().expect(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.headers['ratelimit']).toBeDefined();
      await request(limited).get('/health').expect(200);
    } finally {
      Object.assign(config.rateLimit, original);
    }
  });

  it('SYS-11 applies a global API limit as well', async () => {
    const original = { ...config.rateLimit };
    Object.assign(config.rateLimit, { enabled: true, max: 2, authMax: 100 });
    try {
      const limited = createApp();
      await request(limited).get('/api/v1/auth/me').expect(401);
      await request(limited).get('/api/v1/auth/me').expect(401);
      await request(limited).get('/api/v1/auth/me').expect(429);
    } finally {
      Object.assign(config.rateLimit, original);
    }
  });
});

describe('System: API documentation & UI', () => {
  it('SYS-20 the OpenAPI document is valid OpenAPI 3 (validated by swagger-parser)', async () => {
    const api = await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
    expect(api.openapi).toMatch(/^3\./);
    expect(Object.keys(api.paths).length).toBeGreaterThanOrEqual(15);
  });

  it('SYS-21 serves the spec as JSON and Swagger UI at /api-docs', async () => {
    const json = await request(app).get('/openapi.json').expect(200);
    expect(json.body.info.title).toBe('Docucore API');
    const ui = await request(app).get('/api-docs/').expect(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('SYS-22 every non-public API operation in the spec declares bearer security', async () => {
    const open = new Set(['/auth/register', '/auth/login', '/public/{token}', '/public/{token}/download', '/config', '/health']);
    for (const [route, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!['get', 'post', 'patch', 'put', 'delete'].includes(method) || open.has(route)) continue;
        expect({ route, method, secured: Array.isArray(op.security) && op.security.length > 0 }).toEqual({ route, method, secured: true });
      }
    }
  });

  it('SYS-25 Swagger "Try it out" cannot send accidental filters: query parameters have no examples and only neutral defaults', async () => {
    const resolve = (p) => (p.$ref ? spec.components.parameters[p.$ref.split('/').pop()] : p);
    const queryParams = Object.values(spec.paths)
      .flatMap((ops) => Object.values(ops).flatMap((op) => (Array.isArray(op?.parameters) ? op.parameters : [])))
      .map(resolve)
      .filter((p) => p.in === 'query');
    expect(queryParams.length).toBeGreaterThan(5);
    // Swagger UI pre-fills `example` values into the form, silently filtering results (this bit us once with mimeType).
    for (const p of queryParams) expect({ name: p.name, example: p.schema.example }).toEqual({ name: p.name, example: undefined });
    const withDefault = new Set(queryParams.filter((p) => p.schema.default !== undefined).map((p) => p.name));
    for (const name of withDefault) expect(['scope', 'sort', 'order', 'page', 'limit']).toContain(name);
  });

  it('SYS-24 /config exposes limits and allowed types, and only exposes demo credentials when configured', async () => {
    const res = await request(app).get('/api/v1/config').expect(200);
    expect(res.body).toMatchObject({ maxFileBytes: config.maxFileBytes, demo: null });
    expect(res.body.allowedMimeTypes).toContain('application/pdf');

    const original = config.demo;
    config.demo = { email: 'demo@docucore.dev', password: 'DemoPass123' };
    try {
      expect((await request(app).get('/api/v1/config').expect(200)).body.demo).toEqual(config.demo);
    } finally {
      config.demo = original;
    }
  });

  it('SYS-23 serves the web UI at / (static files, no auth needed)', async () => {
    const page = await request(app).get('/').expect(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.text).toContain('Docucore');
    await request(app).get('/app.js').expect(200);
    await request(app).get('/styles.css').expect(200);
  });
});
