const { setup, teardown, clearDb, createUser, files, request } = require('../helpers/testkit');
const User = require('../../src/models/User');
const Document = require('../../src/models/Document');
const { ensureAdmin, ensureDemo } = require('../../src/services/bootstrap');

let app;
let admin;
let user;

beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  admin = await createUser(app, { name: 'Root', role: 'admin' });
  user = await createUser(app, { name: 'Regular' });
});

describe('Admin & bootstrap', () => {
  it('ADM-01 admin sees system statistics and configured limits', async () => {
    await user.upload(files.pdf('stat'));
    const res = await admin.get('/api/v1/admin/stats').expect(200);
    expect(res.body).toMatchObject({ users: 2, documents: 1, trashed: 0, versions: 1 });
    expect(res.body.storageBytes).toBeGreaterThan(0);
    expect(res.body.limits).toEqual(expect.objectContaining({ maxFileBytes: expect.any(Number), trashRetentionDays: 30 }));
  });

  it('ADM-02 every admin route is forbidden (403) for regular users and 401 without a token', async () => {
    for (const [method, url] of [['get', '/api/v1/admin/stats'], ['get', '/api/v1/admin/users'], ['post', '/api/v1/admin/purge-trash']]) {
      await user[method === 'get' ? 'get' : 'post'](url).expect(403);
      await request(app)[method](url).expect(401);
    }
  });

  it('ADM-03 lists accounts with usage and never exposes password hashes', async () => {
    await user.upload(files.pdf('usage'));
    const res = await admin.get('/api/v1/admin/users?limit=10').expect(200);
    expect(res.body.meta.total).toBe(2);
    const row = res.body.data.find((u) => u.email === user.email);
    expect(row.usage.usedBytes).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('ADM-04 admin can trigger the trash purge', async () => {
    const doc = await user.upload();
    await user.del(`/api/v1/documents/${doc.id}`).expect(204);
    await Document.updateOne({ _id: doc.id }, { deletedAt: new Date(Date.now() - 40 * 86400000) });
    const res = await admin.post('/api/v1/admin/purge-trash').expect(200);
    expect(res.body.purged).toBe(1);
  });

  it('ADM-05 privacy by design: an admin has no implicit access to other users\' documents', async () => {
    const doc = await user.upload();
    await admin.get(`/api/v1/documents/${doc.id}`).expect(404);
    await admin.get(`/api/v1/documents/${doc.id}/download`).expect(404);
    await admin.del(`/api/v1/documents/${doc.id}`).expect(404);
    expect((await admin.get('/api/v1/documents').expect(200)).body.data).toHaveLength(0);
  });

  it('ADM-06 ensureAdmin creates the admin once, promotes an existing account, and never resets a password', async () => {
    const created = await ensureAdmin({ email: 'Boss@Example.com', password: 'BossPass123' });
    expect(created).toMatchObject({ email: 'boss@example.com', role: 'admin' });
    await ensureAdmin({ email: 'boss@example.com', password: 'DifferentPass999' });
    expect(await User.countDocuments({ email: 'boss@example.com' })).toBe(1);
    await request(app).post('/api/v1/auth/login').send({ email: 'boss@example.com', password: 'BossPass123' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: 'boss@example.com', password: 'DifferentPass999' }).expect(401);

    const promoted = await ensureAdmin({ email: user.email, password: 'ignored-because-account-exists1' });
    expect(promoted.role).toBe('admin');
    expect(await ensureAdmin({ email: '', password: '' })).toBeNull();
  });

  it('ADM-07 ensureDemo creates the demo account and sample documents exactly once', async () => {
    const creds = { email: 'demo@docucore.dev', password: 'DemoPass123' };
    await ensureDemo(creds);
    await ensureDemo(creds); // idempotent
    const demo = await User.findOne({ email: creds.email });
    expect(await Document.countDocuments({ owner: demo._id })).toBe(3);
    const login = await request(app).post('/api/v1/auth/login').send(creds).expect(200);
    const list = await request(app).get('/api/v1/documents').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(list.body.data.map((d) => d.title)).toEqual(expect.arrayContaining(['Welcome to Docucore', 'Q3 budget']));
    expect(await ensureDemo({})).toBeNull();
  });
});
