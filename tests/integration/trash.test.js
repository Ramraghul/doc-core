const mongoose = require('mongoose');
const { setup, teardown, clearDb, createUser, files } = require('../helpers/testkit');
const Document = require('../../src/models/Document');
const AuditLog = require('../../src/models/AuditLog');
const { purgeExpiredTrash } = require('../../src/services/documentService');

let app;
let owner;
let other;
const gridFiles = () => mongoose.connection.db.collection('documents.files').countDocuments();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  owner = await createUser(app, { name: 'Owner' });
  other = await createUser(app, { name: 'Other' });
});

describe('Trash, restore and permanent delete', () => {
  it('TRS-01 DELETE moves a document to the trash (204): hidden from lists, visible under scope=trash', async () => {
    const doc = await owner.upload();
    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);

    expect((await owner.get('/api/v1/documents').expect(200)).body.data).toHaveLength(0);
    const trash = await owner.get('/api/v1/documents?scope=trash').expect(200);
    expect(trash.body.data.map((d) => d.id)).toEqual([doc.id]);
    expect(trash.body.data[0].deletedAt).toBeTruthy();
    expect(await gridFiles()).toBe(1); // still recoverable: bytes are kept
  });

  it('TRS-02 a trashed document is invisible to collaborators and cannot be downloaded or versioned', async () => {
    const doc = await owner.upload();
    await owner.post(`/api/v1/documents/${doc.id}/shares`).send({ email: other.email, permission: 'editor' }).expect(201);
    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);

    await other.get(`/api/v1/documents/${doc.id}`).expect(404);
    expect((await other.get('/api/v1/documents?scope=shared').expect(200)).body.data).toHaveLength(0);
    await owner.get(`/api/v1/documents/${doc.id}/download`).expect(404);
    await owner.post(`/api/v1/documents/${doc.id}/versions`).attach('file', files.pdf('x'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(404);
    // ...but the owner can still inspect it (e.g. to decide whether to restore)
    await owner.get(`/api/v1/documents/${doc.id}`).expect(200);
  });

  it('TRS-03 restore brings the document back; restoring a non-trashed document is 409 NOT_IN_TRASH', async () => {
    const doc = await owner.upload();
    const early = await owner.post(`/api/v1/documents/${doc.id}/restore`).expect(409);
    expect(early.body.error.code).toBe('NOT_IN_TRASH');

    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    const res = await owner.post(`/api/v1/documents/${doc.id}/restore`).expect(200);
    expect(res.body.document.deletedAt).toBeNull();
    expect((await owner.get('/api/v1/documents').expect(200)).body.data).toHaveLength(1);
  });

  it('TRS-04 permanent delete requires the trash first (409), then removes the record and every stored version', async () => {
    const doc = await owner.upload(files.pdf('v1'));
    await owner.post(`/api/v1/documents/${doc.id}/versions`).attach('file', files.pdf('v2'), { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201);
    expect(await gridFiles()).toBe(2);

    const early = await owner.del(`/api/v1/documents/${doc.id}/permanent`).expect(409);
    expect(early.body.error.code).toBe('NOT_IN_TRASH');

    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    await owner.del(`/api/v1/documents/${doc.id}/permanent`).expect(204);
    await owner.get(`/api/v1/documents/${doc.id}`).expect(404);
    expect(await gridFiles()).toBe(0);
    expect(await Document.countDocuments()).toBe(0);
  });

  it('TRS-05 permanent delete frees the owner\'s quota', async () => {
    const doc = await owner.upload(files.pdf('x'.repeat(500)));
    expect((await owner.get('/api/v1/auth/me').expect(200)).body.usage.usedBytes).toBeGreaterThan(500);
    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    // trashed files still count until purged
    expect((await owner.get('/api/v1/auth/me').expect(200)).body.usage.usedBytes).toBeGreaterThan(500);
    await owner.del(`/api/v1/documents/${doc.id}/permanent`).expect(204);
    expect((await owner.get('/api/v1/auth/me').expect(200)).body.usage.usedBytes).toBe(0);
  });

  it('TRS-06 only the owner can trash, restore or permanently delete (403 editor, 404 stranger)', async () => {
    const doc = await owner.upload();
    await owner.post(`/api/v1/documents/${doc.id}/shares`).send({ email: other.email, permission: 'editor' }).expect(201);
    await other.del(`/api/v1/documents/${doc.id}`).expect(403);

    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    const stranger = await createUser(app);
    await stranger.post(`/api/v1/documents/${doc.id}/restore`).expect(404);
    await other.post(`/api/v1/documents/${doc.id}/restore`).expect(404); // collaborators lose sight of trashed docs
    await stranger.del(`/api/v1/documents/${doc.id}/permanent`).expect(404);
  });

  it('TRS-07 the trash view lists only my own trashed documents', async () => {
    const mine = await owner.upload(files.pdf('m'));
    const theirs = await other.upload(files.pdf('t'));
    await owner.del(`/api/v1/documents/${mine.id}`).expect(204);
    await other.del(`/api/v1/documents/${theirs.id}`).expect(204);
    expect((await owner.get('/api/v1/documents?scope=trash').expect(200)).body.data.map((d) => d.id)).toEqual([mine.id]);
  });

  it('TRS-08 purgeExpiredTrash removes only documents trashed longer than the retention window', async () => {
    const old = await owner.upload(files.pdf('old'));
    const recent = await owner.upload(files.pdf('recent'));
    const live = await owner.upload(files.pdf('live'));
    await owner.del(`/api/v1/documents/${old.id}`).expect(204);
    await owner.del(`/api/v1/documents/${recent.id}`).expect(204);
    await Document.updateOne({ _id: old.id }, { deletedAt: daysAgo(31) });
    await Document.updateOne({ _id: recent.id }, { deletedAt: daysAgo(2) });

    expect(await purgeExpiredTrash(30)).toBe(1);
    expect(await Document.findById(old.id)).toBeNull();
    expect(await Document.findById(recent.id)).not.toBeNull();
    expect(await Document.findById(live.id)).not.toBeNull();
    expect(await gridFiles()).toBe(2);
  });

  it('TRS-09 the audit trail outlives the document it describes', async () => {
    const doc = await owner.upload();
    await owner.del(`/api/v1/documents/${doc.id}`).expect(204);
    await owner.del(`/api/v1/documents/${doc.id}/permanent`).expect(204);
    const actions = (await AuditLog.find({ document: doc.id }).sort({ createdAt: 1 })).map((a) => a.action);
    expect(actions).toEqual(['document.created', 'document.trashed', 'document.purged']);
  });
});
