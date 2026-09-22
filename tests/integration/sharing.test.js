const { setup, teardown, clearDb, createUser, files, binary, request } = require('../helpers/testkit');
const Document = require('../../src/models/Document');

let app;
let owner;
let editor;
let viewer;
let stranger;
let doc;

const share = (user, id, target, permission) =>
  user.post(`/api/v1/documents/${id}/shares`).send({ email: target.email, permission });

beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  [owner, editor, viewer, stranger] = await Promise.all(['Owner', 'Editor', 'Viewer', 'Stranger'].map((name) => createUser(app, { name })));
  doc = await owner.upload(files.pdf('shared doc'), { filename: 'shared.pdf', fields: { title: 'Shared' } });
  await share(owner, doc.id, editor, 'editor').expect(201);
  await share(owner, doc.id, viewer, 'viewer').expect(201);
});

describe('Sharing & permissions', () => {
  it('SHR-01 a viewer can read and download, and sees the document as "viewer" without the share list', async () => {
    const res = await viewer.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(res.body.document.permission).toBe('viewer');
    expect(res.body.document).not.toHaveProperty('sharedWith');
    expect(res.body.document).not.toHaveProperty('publicLink');
    const dl = await viewer.get(`/api/v1/documents/${doc.id}/download`).buffer(true).parse(binary).expect(200);
    expect(dl.body.toString()).toContain('shared doc');
    await viewer.get(`/api/v1/documents/${doc.id}/versions`).expect(200);
  });

  it('SHR-02 a viewer cannot edit, add versions, delete, share or read the activity log (403)', async () => {
    const id = doc.id;
    expect((await viewer.patch(`/api/v1/documents/${id}`).send({ title: 'x' }).expect(403)).body.error.code).toBe('INSUFFICIENT_PERMISSION');
    await viewer.post(`/api/v1/documents/${id}/versions`).attach('file', files.pdf('new'), { filename: 'n.pdf', contentType: 'application/pdf' }).expect(403);
    await viewer.del(`/api/v1/documents/${id}`).expect(403);
    await share(viewer, id, stranger, 'viewer').expect(403);
    await viewer.post(`/api/v1/documents/${id}/public-link`).send({}).expect(403);
    await viewer.get(`/api/v1/documents/${id}/activity`).expect(403);
  });

  it('SHR-03 an editor can edit, add versions and read activity, but cannot delete or share', async () => {
    const id = doc.id;
    await editor.patch(`/api/v1/documents/${id}`).send({ title: 'Edited by editor' }).expect(200);
    const v = await editor.post(`/api/v1/documents/${id}/versions`).attach('file', files.pdf('editor version'), { filename: 'e.pdf', contentType: 'application/pdf' }).expect(201);
    expect(v.body.document.currentVersion).toBe(2);
    await editor.get(`/api/v1/documents/${id}/activity`).expect(200);
    await editor.del(`/api/v1/documents/${id}`).expect(403);
    await share(editor, id, stranger, 'viewer').expect(403);
    await editor.post(`/api/v1/documents/${id}/public-link`).send({}).expect(403);
  });

  it('SHR-04 re-sharing with the same user updates the permission (no duplicate entry)', async () => {
    const res = await share(owner, doc.id, viewer, 'editor').expect(201);
    const entries = res.body.document.sharedWith.filter((s) => s.user.email === viewer.email);
    expect(entries).toEqual([expect.objectContaining({ permission: 'editor' })]);
    expect(res.body.document.sharedWith).toHaveLength(2);
    await viewer.patch(`/api/v1/documents/${doc.id}`).send({ title: 'now allowed' }).expect(200);
  });

  it('SHR-05 the owner sees who has access; the response includes names and emails', async () => {
    const res = await owner.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(res.body.document.sharedWith).toHaveLength(2);
    expect(res.body.document.sharedWith[0].user).toMatchObject({ name: expect.any(String), email: expect.any(String) });
    expect(res.body.document.sharedWithCount).toBe(2);
  });

  it('SHR-06 validates share requests: unknown email, self-share, bad permission', async () => {
    const unknown = await owner.post(`/api/v1/documents/${doc.id}/shares`).send({ email: 'nobody@example.com', permission: 'viewer' }).expect(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');
    const self = await share(owner, doc.id, owner, 'viewer').expect(400);
    expect(self.body.error.code).toBe('CANNOT_SHARE_WITH_OWNER');
    await owner.post(`/api/v1/documents/${doc.id}/shares`).send({ email: stranger.email, permission: 'owner' }).expect(400);
  });

  it('SHR-07 unsharing removes access immediately (404) and unsharing a non-member is 404 SHARE_NOT_FOUND', async () => {
    await owner.del(`/api/v1/documents/${doc.id}/shares/${viewer.id}`).expect(200);
    await viewer.get(`/api/v1/documents/${doc.id}`).expect(404);
    const again = await owner.del(`/api/v1/documents/${doc.id}/shares/${viewer.id}`).expect(404);
    expect(again.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('SHR-08 a stranger sees nothing: 404 on every document route', async () => {
    const id = doc.id;
    await stranger.get(`/api/v1/documents/${id}`).expect(404);
    await stranger.get(`/api/v1/documents/${id}/download`).expect(404);
    await stranger.get(`/api/v1/documents/${id}/activity`).expect(404);
    await stranger.del(`/api/v1/documents/${id}`).expect(404);
    await share(stranger, id, viewer, 'viewer').expect(404);
    expect((await stranger.get('/api/v1/documents').expect(200)).body.data).toHaveLength(0);
  });

  it('SHR-09 sharing is audited', async () => {
    const res = await owner.get(`/api/v1/documents/${doc.id}/activity`).expect(200);
    const shared = res.body.activity.filter((a) => a.action === 'document.shared');
    expect(shared).toHaveLength(2);
    expect(shared.map((a) => a.meta.with).sort()).toEqual([editor.email, viewer.email].sort());
  });
});

describe('Public links', () => {
  const createLink = (hours) => owner.post(`/api/v1/documents/${doc.id}/public-link`).send(hours ? { expiresInHours: hours } : {});

  it('SHR-20 creates a link; anyone can read its details and download without authentication', async () => {
    const link = (await createLink(2).expect(201)).body;
    expect(link.token.length).toBeGreaterThanOrEqual(40);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

    const info = await request(app).get(`/api/v1/public/${link.token}`).expect(200);
    expect(info.body).toMatchObject({ title: 'Shared', filename: 'shared.pdf', mimeType: 'application/pdf' });
    const dl = await request(app).get(`/api/v1/public/${link.token}/download`).buffer(true).parse(binary).expect(200);
    expect(dl.body.toString()).toContain('shared doc');
    expect(dl.headers['content-disposition']).toContain('attachment');
  });

  it('SHR-21 stores only a hash of the token, never the token itself', async () => {
    const { token } = (await createLink().expect(201)).body;
    const stored = await Document.findById(doc.id);
    expect(stored.publicLink.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored.toObject())).not.toContain(token);
    const detail = await owner.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(token);
    expect(detail.body.document.publicLink).toMatchObject({ expired: false });
  });

  it('SHR-22 an expired link returns 410 LINK_EXPIRED', async () => {
    const { token } = (await createLink().expect(201)).body;
    await Document.updateOne({ _id: doc.id }, { 'publicLink.expiresAt': new Date(Date.now() - 1000) });
    const res = await request(app).get(`/api/v1/public/${token}/download`).expect(410);
    expect(res.body.error.code).toBe('LINK_EXPIRED');
  });

  it('SHR-23 revoking a link kills it (404); revoking when none exists is 404', async () => {
    const { token } = (await createLink().expect(201)).body;
    await owner.del(`/api/v1/documents/${doc.id}/public-link`).expect(204);
    await request(app).get(`/api/v1/public/${token}`).expect(404);
    const res = await owner.del(`/api/v1/documents/${doc.id}/public-link`).expect(404);
    expect(res.body.error.code).toBe('LINK_NOT_FOUND');
  });

  it('SHR-24 creating a new link invalidates the previous one', async () => {
    const first = (await createLink().expect(201)).body.token;
    const second = (await createLink().expect(201)).body.token;
    await request(app).get(`/api/v1/public/${first}`).expect(404);
    await request(app).get(`/api/v1/public/${second}`).expect(200);
  });

  it('SHR-25 a link stops working while the document is in the trash, and resumes after restore', async () => {
    const { token } = (await createLink().expect(201)).body;
    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    await request(app).get(`/api/v1/public/${token}/download`).expect(404);
    await owner.post(`/api/v1/documents/${doc.id}/restore`).expect(200);
    await request(app).get(`/api/v1/public/${token}/download`).buffer(true).parse(binary).expect(200);
  });

  it('SHR-26 a public link always serves the newest version', async () => {
    const { token } = (await createLink().expect(201)).body;
    await owner.post(`/api/v1/documents/${doc.id}/versions`).attach('file', files.pdf('brand new content'), { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201);
    const dl = await request(app).get(`/api/v1/public/${token}/download`).buffer(true).parse(binary).expect(200);
    expect(dl.body.toString()).toContain('brand new content');
  });

  it('SHR-27 rejects malformed and unknown tokens (400 / 404)', async () => {
    await request(app).get('/api/v1/public/short').expect(400);
    await request(app).get(`/api/v1/public/${'x'.repeat(43)}`).expect(404);
    await request(app).get(`/api/v1/public/${'x'.repeat(30)}!!`).expect(400);
  });

  it('SHR-28 validates lifetime bounds (1–720 hours)', async () => {
    await createLink(720).expect(201);
    await owner.post(`/api/v1/documents/${doc.id}/public-link`).send({ expiresInHours: 0 }).expect(400);
    await owner.post(`/api/v1/documents/${doc.id}/public-link`).send({ expiresInHours: 721 }).expect(400);
  });

  it('SHR-29 link creation and anonymous downloads are audited', async () => {
    const { token } = (await createLink().expect(201)).body;
    await request(app).get(`/api/v1/public/${token}/download`).buffer(true).parse(binary).expect(200);
    const res = await owner.get(`/api/v1/documents/${doc.id}/activity`).expect(200);
    const actions = res.body.activity.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['document.link_created', 'document.public_downloaded']));
    expect(res.body.activity.find((a) => a.action === 'document.public_downloaded').actor).toBeNull();
  });
});
