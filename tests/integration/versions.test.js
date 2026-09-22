const mongoose = require('mongoose');
const config = require('../../src/config/env');
const { setup, teardown, clearDb, createUser, files, binary } = require('../helpers/testkit');

let app;
let alice;
let bob;
const gridFiles = () => mongoose.connection.db.collection('documents.files').countDocuments();

const addVersion = (user, id, buf, { filename = 'v.pdf', contentType = 'application/pdf', comment } = {}) => {
  const req = user.post(`/api/v1/documents/${id}/versions`).attach('file', buf, { filename, contentType });
  return comment ? req.field('comment', comment) : req;
};

beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  alice = await createUser(app, { name: 'Alice' });
  bob = await createUser(app, { name: 'Bob' });
});

describe('Versions', () => {
  it('VER-01 adding a version bumps currentVersion/versionCount and updates "latest"', async () => {
    const doc = await alice.upload(files.pdf('v1'), { filename: 'contract.pdf' });
    const res = await addVersion(alice, doc.id, files.pdf('v2 is longer'), { filename: 'contract-final.pdf', comment: 'Legal edits' }).expect(201);
    expect(res.body.document).toMatchObject({ currentVersion: 2, versionCount: 2 });
    expect(res.body.document.latest).toMatchObject({ version: 2, filename: 'contract-final.pdf' });
  });

  it('VER-02 lists versions newest-first with uploader, comment and isCurrent', async () => {
    const doc = await alice.upload(files.pdf('v1'));
    await addVersion(alice, doc.id, files.pdf('v2'), { comment: 'second' }).expect(201);
    const res = await alice.get(`/api/v1/documents/${doc.id}/versions`).expect(200);
    expect(res.body.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(res.body.versions[0]).toMatchObject({ comment: 'second', isCurrent: true, uploadedBy: { id: alice.id } });
    expect(res.body.versions[1]).toMatchObject({ comment: 'Initial version', isCurrent: false });
    expect(JSON.stringify(res.body)).not.toContain('fileId');
  });

  it('VER-03 downloads the exact bytes with safe headers (attachment, nosniff, correct type & length)', async () => {
    const buf = files.pdf('download me');
    const doc = await alice.upload(buf, { filename: 'report.pdf' });
    const res = await alice.get(`/api/v1/documents/${doc.id}/download`).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(res.body, buf)).toBe(0);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="report.pdf"');
    expect(res.headers['content-length']).toBe(String(buf.length));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('VER-04 downloads an older version with ?version=', async () => {
    const v1 = files.pdf('first');
    const doc = await alice.upload(v1);
    await addVersion(alice, doc.id, files.pdf('second')).expect(201);
    const old = await alice.get(`/api/v1/documents/${doc.id}/download?version=1`).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(old.body, v1)).toBe(0);
    const cur = await alice.get(`/api/v1/documents/${doc.id}/download`).buffer(true).parse(binary).expect(200);
    expect(cur.body.toString()).toContain('second');
  });

  it('VER-05 returns 404 VERSION_NOT_FOUND for unknown versions and 400 for a non-numeric version', async () => {
    const doc = await alice.upload();
    const res = await alice.get(`/api/v1/documents/${doc.id}/download?version=9`).expect(404);
    expect(res.body.error.code).toBe('VERSION_NOT_FOUND');
    await alice.get(`/api/v1/documents/${doc.id}/download?version=abc`).expect(400);
  });

  it('VER-06 rejects a byte-identical upload (409 DUPLICATE_VERSION) and stores nothing extra', async () => {
    const buf = files.pdf('same');
    const doc = await alice.upload(buf);
    const res = await addVersion(alice, doc.id, buf).expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_VERSION');
    expect(await gridFiles()).toBe(1);
  });

  it('VER-07 retention: keeps only the newest N versions and deletes pruned files from storage', async () => {
    const original = config.maxVersions;
    config.maxVersions = 3;
    try {
      const doc = await alice.upload(files.pdf('v1'));
      for (let i = 2; i <= 5; i += 1) await addVersion(alice, doc.id, files.pdf(`v${i}`)).expect(201);

      const res = await alice.get(`/api/v1/documents/${doc.id}`).expect(200);
      expect(res.body.document).toMatchObject({ currentVersion: 5, versionCount: 3 });
      const versions = await alice.get(`/api/v1/documents/${doc.id}/versions`).expect(200);
      expect(versions.body.versions.map((v) => v.version)).toEqual([5, 4, 3]);
      await alice.get(`/api/v1/documents/${doc.id}/download?version=1`).expect(404);
      expect(await gridFiles()).toBe(3); // no orphaned blobs
      const activity = await alice.get(`/api/v1/documents/${doc.id}/activity`).expect(200);
      expect(activity.body.activity.map((a) => a.action)).toContain('document.version_pruned');
    } finally {
      config.maxVersions = original;
    }
  });

  it('VER-08 concurrent uploads never produce duplicate version numbers or orphaned files', async () => {
    const doc = await alice.upload(files.pdf('base'));
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => addVersion(alice, doc.id, files.pdf(`racer ${i}`))),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(statuses).toContain(201);

    const list = await alice.get(`/api/v1/documents/${doc.id}/versions`).expect(200);
    const numbers = list.body.versions.map((v) => v.version);
    expect(new Set(numbers).size).toBe(numbers.length);
    const succeeded = statuses.filter((s) => s === 201).length;
    expect(numbers).toHaveLength(1 + succeeded);
    expect(await gridFiles()).toBe(1 + succeeded); // rejected racers cleaned up their blobs
  });

  it('VER-09 emits an RFC 5987 Content-Disposition for non-Latin-1 filenames (and never breaks the header)', async () => {
    const doc = await alice.upload(files.pdf('u'), { filename: '履歴書.pdf' });
    const res = await alice.get(`/api/v1/documents/${doc.id}/download`).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''%E5%B1%A5%E6%AD%B4%E6%9B%B8.pdf");
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);

    const latin = await alice.upload(files.pdf('l'), { filename: 'résumé.pdf' });
    const res2 = await alice.get(`/api/v1/documents/${latin.id}/download`).buffer(true).parse(binary).expect(200);
    expect(res2.headers['content-disposition']).toMatch(/^attachment; filename=/);
  });

  it('VER-10 returns a clean JSON error (not a corrupted body) when the stored blob has gone missing', async () => {
    const doc = await alice.upload(files.pdf('will vanish'));
    await mongoose.connection.db.collection('documents.files').deleteMany({});
    await mongoose.connection.db.collection('documents.chunks').deleteMany({});
    const res = await alice.get(`/api/v1/documents/${doc.id}/download`).expect(404);
    expect(res.body.error.code).toBe('FILE_MISSING');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('VER-11 a stranger cannot list, download or add versions (404)', async () => {
    const doc = await alice.upload();
    await bob.get(`/api/v1/documents/${doc.id}/versions`).expect(404);
    await bob.get(`/api/v1/documents/${doc.id}/download`).expect(404);
    await addVersion(bob, doc.id, files.pdf('evil')).expect(404);
  });

  it('VER-12 rejects invalid version uploads (bad type / mismatch) without changing the document', async () => {
    const doc = await alice.upload();
    await addVersion(alice, doc.id, files.html(), { filename: 'x.html', contentType: 'text/html' }).expect(415);
    await addVersion(alice, doc.id, files.exe(), { filename: 'x.pdf' }).expect(415);
    const res = await alice.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(res.body.document.currentVersion).toBe(1);
    expect(await gridFiles()).toBe(1);
  });

  it('VER-13 audits downloads and version additions', async () => {
    const doc = await alice.upload(files.pdf('a'));
    await addVersion(alice, doc.id, files.pdf('b')).expect(201);
    await alice.get(`/api/v1/documents/${doc.id}/download`).buffer(true).parse(binary).expect(200);
    const res = await alice.get(`/api/v1/documents/${doc.id}/activity`).expect(200);
    expect(res.body.activity.map((a) => a.action)).toEqual(['document.downloaded', 'document.version_added', 'document.created']);
  });
});
