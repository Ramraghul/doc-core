const config = require('../../src/config/env');
const { createApp } = require('../../src/app');
const Document = require('../../src/models/Document');
const { setup, teardown, clearDb, createUser, request } = require('../helpers/testkit');

/**
 * GET /api/v1/internal/purge-trash stands in for the in-process trash-purge timer (src/server.js) on
 * platforms with no long-running process (Vercel). It is deliberately NOT protected by a user JWT —
 * schedulers (Vercel Cron, the GitHub Actions fallback) can't hold one — only by a shared secret.
 */
let app;
let originalSecret;
beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(clearDb);
beforeEach(() => { originalSecret = config.cronSecret; });
afterEach(() => { config.cronSecret = originalSecret; });

describe('Cron / scheduler endpoint', () => {
  it('CRON-01 is disabled (503) when CRON_SECRET is not configured, regardless of what is sent', async () => {
    config.cronSecret = undefined;
    const res = await request(app).get('/api/v1/internal/purge-trash').set('Authorization', 'Bearer anything').expect(503);
    expect(res.body.error.code).toBe('CRON_NOT_CONFIGURED');
  });

  it('CRON-02 rejects a missing Authorization header once configured', async () => {
    config.cronSecret = 'test-cron-secret-value';
    const res = await request(app).get('/api/v1/internal/purge-trash').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('CRON-03 rejects a wrong secret and a non-Bearer scheme', async () => {
    config.cronSecret = 'test-cron-secret-value';
    await request(app).get('/api/v1/internal/purge-trash').set('Authorization', 'Bearer wrong-secret').expect(401);
    await request(app).get('/api/v1/internal/purge-trash').set('Authorization', 'Basic test-cron-secret-value').expect(401);
  });

  it('CRON-04 accepts the correct secret with no user JWT at all, and purges expired trash', async () => {
    config.cronSecret = 'test-cron-secret-value';
    const user = await createUser(app);
    const doc = await user.upload();
    await user.del(`/api/v1/documents/${doc.id}`).expect(204);
    await Document.updateOne({ _id: doc.id }, { deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) });

    const res = await request(app).get('/api/v1/internal/purge-trash').set('Authorization', `Bearer test-cron-secret-value`).expect(200);
    expect(res.body).toEqual({ purged: 1 });
    expect(await Document.findById(doc.id)).toBeNull();
  });

  it('CRON-05 is unaffected by, and does not require, the global rate limiter’s auth bucket', async () => {
    config.cronSecret = 'test-cron-secret-value';
    const limited = createApp(); // rebuild so any config-dependent middleware picks up current settings
    const res = await request(limited).get('/api/v1/internal/purge-trash').set('Authorization', 'Bearer test-cron-secret-value').expect(200);
    expect(res.body).toEqual({ purged: 0 });
  });
});
