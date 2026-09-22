const mongoose = require('mongoose');
const config = require('../../src/config/env');
const { setup, teardown, clearDb, createUser, files, request } = require('../helpers/testkit');

let app;
let alice;
let bob;
const gridFiles = () => mongoose.connection.db.collection('documents.files').countDocuments();

// Config is read at request time, so tests can tighten limits and restore them afterwards.
const saved = { ...config };
afterEach(() => {
  config.maxFileBytes = saved.maxFileBytes;
  config.quotaBytes = saved.quotaBytes;
});

beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  alice = await createUser(app, { name: 'Alice' });
  bob = await createUser(app, { name: 'Bob' });
});

describe('Limits & quotas', () => {
  it('LIM-01 rejects files over MAX_FILE_SIZE with 413 FILE_TOO_LARGE and stores nothing', async () => {
    config.maxFileBytes = 200;
    const res = await alice
      .post('/api/v1/documents')
      .attach('file', files.pdf('x'.repeat(500)), { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await gridFiles()).toBe(0);
    await alice.upload(files.pdf('ok'), { filename: 'small.pdf' }); // under the limit still works
  });

  it('LIM-02 enforces the per-user storage quota (413 QUOTA_EXCEEDED) and stores nothing extra', async () => {
    config.quotaBytes = 1000;
    await alice.upload(files.pdf('a'.repeat(600)), { filename: 'a.pdf' });
    const res = await alice
      .post('/api/v1/documents')
      .attach('file', files.pdf('b'.repeat(600)), { filename: 'b.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(await gridFiles()).toBe(1);
  });

  it('LIM-03 quotas are per user: Bob is unaffected by Alice being full', async () => {
    config.quotaBytes = 1000;
    await alice.upload(files.pdf('a'.repeat(900)), { filename: 'a.pdf' });
    await bob.upload(files.pdf('b'.repeat(900)), { filename: 'b.pdf' });
  });

  it('LIM-04 new versions count toward the quota too', async () => {
    config.quotaBytes = 1200;
    const doc = await alice.upload(files.pdf('a'.repeat(600)));
    const res = await alice
      .post(`/api/v1/documents/${doc.id}/versions`)
      .attach('file', files.pdf('b'.repeat(700)), { filename: 'v2.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('LIM-05 an editor\'s new version is charged to the document owner\'s quota, not the editor\'s', async () => {
    config.quotaBytes = 1200;
    const doc = await alice.upload(files.pdf('a'.repeat(600)));
    await alice.post(`/api/v1/documents/${doc.id}/shares`).send({ email: bob.email, permission: 'editor' }).expect(201);
    const res = await bob
      .post(`/api/v1/documents/${doc.id}/versions`)
      .attach('file', files.pdf('b'.repeat(700)), { filename: 'v2.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect((await bob.get('/api/v1/auth/me')).body.usage.usedBytes).toBe(0);
  });

  it('LIM-06 rejects oversized JSON bodies (413) and malformed JSON (400 INVALID_JSON)', async () => {
    const big = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) }).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ').expect(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });
});
