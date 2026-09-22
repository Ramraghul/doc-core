const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { setup, teardown, clearDb, createUser, files, request } = require('../helpers/testkit');

let app;
let alice;
let bob;
beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(async () => {
  await clearDb();
  alice = await createUser(app, { name: 'Alice' });
  bob = await createUser(app, { name: 'Bob' });
});

describe('Documents — create', () => {
  it('DOC-01 uploads a PDF: creates document v1 with owner, checksum and defaults', async () => {
    const buf = files.pdf('one');
    const doc = await alice.upload(buf, { filename: 'Annual Report.pdf' });
    expect(doc).toMatchObject({
      title: 'Annual Report', // defaults to filename without extension
      permission: 'owner',
      currentVersion: 1,
      versionCount: 1,
      tags: [],
      owner: { id: alice.id, email: alice.email },
    });
    expect(doc.latest).toMatchObject({ filename: 'Annual Report.pdf', mimeType: 'application/pdf', size: buf.length });
    expect(doc.latest.checksum).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    expect(doc).not.toHaveProperty('versions');
  });

  it('DOC-02 accepts title, description and tags (normalised) alongside the file', async () => {
    const doc = await alice.upload(files.pdf(), {
      fields: { title: '  Invoice #42 ', description: 'March invoice', tags: 'Finance, 2026,finance' },
    });
    expect(doc).toMatchObject({ title: 'Invoice #42', description: 'March invoice', tags: ['finance', '2026'] });
  });

  it('DOC-03 rejects a request without a file (400 FILE_REQUIRED)', async () => {
    const res = await alice.post('/api/v1/documents').field('title', 'no file').expect(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
    const json = await alice.post('/api/v1/documents').send({ title: 'json only' }).expect(400);
    expect(json.body.error.code).toBe('FILE_REQUIRED');
  });

  it('DOC-04 rejects a disallowed file type such as HTML (415 UNSUPPORTED_FILE_TYPE)', async () => {
    const res = await alice.post('/api/v1/documents').attach('file', files.html(), { filename: 'x.html', contentType: 'text/html' }).expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('DOC-05 rejects content that does not match the declared type (executable disguised as PDF)', async () => {
    const res = await alice.post('/api/v1/documents').attach('file', files.exe(), { filename: 'invoice.pdf', contentType: 'application/pdf' }).expect(415);
    expect(res.body.error.code).toBe('FILE_CONTENT_MISMATCH');
  });

  it('DOC-06 infers the type from the extension when the browser sends application/octet-stream', async () => {
    const doc = await alice.upload(files.text('# Title'), { filename: 'readme.md', contentType: 'application/octet-stream' });
    expect(doc.latest.mimeType).toBe('text/markdown');
  });

  it('DOC-07 rejects an empty file (400 EMPTY_FILE)', async () => {
    const res = await alice.post('/api/v1/documents').attach('file', Buffer.alloc(0), { filename: 'empty.txt', contentType: 'text/plain' }).expect(400);
    expect(res.body.error.code).toBe('EMPTY_FILE');
  });

  it('DOC-08 validates tags (max 10, allowed characters)', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `t${i}`).join(',');
    const res = await alice.post('/api/v1/documents').attach('file', files.pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).field('tags', many).expect(400);
    expect(res.body.error.details[0].path).toBe('tags');
    await alice.post('/api/v1/documents').attach('file', files.pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).field('tags', '<b>').expect(400);
  });

  it('DOC-09 keeps unicode filenames and strips path components from hostile names', async () => {
    const uni = await alice.upload(files.pdf('u'), { filename: 'résumé 履歴書.pdf' });
    expect(uni.latest.filename).toBe('résumé 履歴書.pdf');
    const hostile = await alice.upload(files.text('x'), { filename: '../../etc/passwd.txt', contentType: 'text/plain' });
    expect(hostile.latest.filename).toBe('passwd.txt');
  });

  it('DOC-10 rejects a wrong multipart field name (400 UNEXPECTED_FILE_FIELD)', async () => {
    const res = await alice.post('/api/v1/documents').attach('document', files.pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
    expect(res.body.error.code).toBe('UNEXPECTED_FILE_FIELD');
  });

  it('DOC-11 requires authentication', async () => {
    await request(app).post('/api/v1/documents').attach('file', files.pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(401);
    await request(app).get('/api/v1/documents').expect(401);
  });

  it('DOC-12 stores the bytes in GridFS (not on disk / not inline in the document)', async () => {
    await alice.upload(files.pdf('gridfs'));
    const count = await mongoose.connection.db.collection('documents.files').countDocuments();
    expect(count).toBe(1);
  });
});

describe('Documents — read, list, search', () => {
  it('DOC-20 gets a document by id; a stranger gets 404 (existence is not revealed)', async () => {
    const doc = await alice.upload();
    const mine = await alice.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(mine.body.document.id).toBe(doc.id);
    const theirs = await bob.get(`/api/v1/documents/${doc.id}`).expect(404);
    expect(theirs.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('DOC-21 returns 400 for a malformed id and 404 for a well-formed unknown id', async () => {
    await alice.get('/api/v1/documents/not-an-id').expect(400);
    await alice.get(`/api/v1/documents/${'a'.repeat(24)}`).expect(404);
  });

  it('DOC-22 lists only my own documents (tenant isolation) with pagination metadata', async () => {
    await alice.upload(files.pdf('1'), { filename: 'a1.pdf' });
    await alice.upload(files.pdf('2'), { filename: 'a2.pdf' });
    await bob.upload(files.pdf('3'), { filename: 'b1.pdf' });

    const res = await alice.get('/api/v1/documents').expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((d) => d.owner.id === alice.id)).toBe(true);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('DOC-23 paginates without overlap or gaps', async () => {
    for (let i = 0; i < 5; i += 1) await alice.upload(files.pdf(`p${i}`), { filename: `doc${i}.pdf` });
    const p1 = await alice.get('/api/v1/documents?limit=2&page=1&sort=title&order=asc').expect(200);
    const p2 = await alice.get('/api/v1/documents?limit=2&page=2&sort=title&order=asc').expect(200);
    const p3 = await alice.get('/api/v1/documents?limit=2&page=3&sort=title&order=asc').expect(200);
    expect(p1.body.meta).toMatchObject({ total: 5, totalPages: 3 });
    const titles = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((d) => d.title);
    expect(titles).toEqual(['doc0', 'doc1', 'doc2', 'doc3', 'doc4']);
  });

  it('DOC-24 rejects out-of-range paging (limit > 100, page < 1)', async () => {
    await alice.get('/api/v1/documents?limit=101').expect(400);
    await alice.get('/api/v1/documents?page=0').expect(400);
  });

  it('DOC-25 searches title / description / tags / filename, partial and case-insensitive', async () => {
    await alice.upload(files.pdf('a'), { filename: 'x.pdf', fields: { title: 'Quarterly Invoice' } });
    await alice.upload(files.pdf('b'), { filename: 'y.pdf', fields: { title: 'Holiday', description: 'invoice for the trip' } });
    await alice.upload(files.pdf('c'), { filename: 'z.pdf', fields: { title: 'Other', tags: 'invoices' } });
    await alice.upload(files.pdf('d'), { filename: 'INVOICE-scan.pdf', fields: { title: 'Scan' } });
    await alice.upload(files.pdf('e'), { filename: 'q.pdf', fields: { title: 'Unrelated' } });

    const res = await alice.get('/api/v1/documents?q=INVOIC').expect(200);
    expect(res.body.data.map((d) => d.title).sort()).toEqual(['Holiday', 'Other', 'Quarterly Invoice', 'Scan']);
  });

  it('DOC-26 treats regex metacharacters in the search text literally (no ReDoS / injection)', async () => {
    await alice.upload(files.pdf('a'), { fields: { title: 'Plain title' } });
    await alice.upload(files.pdf('b'), { fields: { title: 'Cost (draft) [v2]' } });
    const dotStar = await alice.get('/api/v1/documents').query({ q: '.*' }).expect(200);
    expect(dotStar.body.data).toHaveLength(0);
    const paren = await alice.get('/api/v1/documents').query({ q: '(draft)' }).expect(200);
    expect(paren.body.data.map((d) => d.title)).toEqual(['Cost (draft) [v2]']);
    await alice.get('/api/v1/documents').query({ q: '((((' }).expect(200);
  });

  it('DOC-27 filters by tag and mimeType, and sorts by size', async () => {
    await alice.upload(files.pdf('small'), { filename: 'a.pdf', fields: { title: 'A', tags: 'work' } });
    await alice.upload(files.png('a-much-larger-png-payload-'.repeat(10)), { filename: 'b.png', contentType: 'image/png', fields: { title: 'B', tags: 'work,img' } });
    await alice.upload(files.text('t'), { filename: 'c.txt', contentType: 'text/plain', fields: { title: 'C' } });

    expect((await alice.get('/api/v1/documents?tag=work').expect(200)).body.data).toHaveLength(2);
    expect((await alice.get('/api/v1/documents?tag=IMG').expect(200)).body.data.map((d) => d.title)).toEqual(['B']);
    expect((await alice.get('/api/v1/documents?mimeType=image/png').expect(200)).body.data.map((d) => d.title)).toEqual(['B']);
    const bySize = await alice.get('/api/v1/documents?sort=size&order=desc').expect(200);
    expect(bySize.body.data.map((d) => d.title)).toEqual(['B', 'A', 'C']);
  });

  it('DOC-28 never interprets bracket/operator syntax in query strings as a Mongo operator', async () => {
    await alice.upload(files.pdf('a'), { fields: { title: 'x marks the spot' } });
    await alice.upload(files.pdf('b'), { fields: { title: 'another' } });
    // Express 5 keeps `q[$ne]` as a literal key (no nested objects), so it is simply an unknown, ignored parameter.
    // If it were interpreted as {$ne:'x'} the first document would be excluded / results would differ.
    for (const qs of ['q[$ne]=x', 'q[$regex]=.*', 'tag[$ne]=zzz', 'scope[$ne]=owned']) {
      const res = await alice.get(`/api/v1/documents?${qs}`).expect(200);
      expect(res.body.data).toHaveLength(2);
    }
  });

  it('DOC-29 scope=owned vs scope=shared', async () => {
    const mine = await alice.upload(files.pdf('mine'), { fields: { title: 'Mine' } });
    const theirs = await bob.upload(files.pdf('theirs'), { fields: { title: 'Theirs' } });
    await bob.post(`/api/v1/documents/${theirs.id}/shares`).send({ email: alice.email, permission: 'viewer' }).expect(201);

    const all = await alice.get('/api/v1/documents').expect(200);
    expect(all.body.data.map((d) => d.title).sort()).toEqual(['Mine', 'Theirs']);
    const owned = await alice.get('/api/v1/documents?scope=owned').expect(200);
    expect(owned.body.data.map((d) => d.id)).toEqual([mine.id]);
    const shared = await alice.get('/api/v1/documents?scope=shared').expect(200);
    expect(shared.body.data.map((d) => d.id)).toEqual([theirs.id]);
    expect(shared.body.data[0].permission).toBe('viewer');
  });
});

describe('Documents — update & activity', () => {
  it('DOC-30 edits title, description and tags; unspecified fields are untouched', async () => {
    const doc = await alice.upload(files.pdf(), { fields: { title: 'Old', description: 'keep me', tags: 'a' } });
    const res = await alice.patch(`/api/v1/documents/${doc.id}`).send({ title: 'New', tags: ['x', 'y'] }).expect(200);
    expect(res.body.document).toMatchObject({ title: 'New', description: 'keep me', tags: ['x', 'y'] });
    const cleared = await alice.patch(`/api/v1/documents/${doc.id}`).send({ tags: [] }).expect(200);
    expect(cleared.body.document.tags).toEqual([]);
  });

  it('DOC-31 rejects an empty patch and invalid values', async () => {
    const doc = await alice.upload();
    await alice.patch(`/api/v1/documents/${doc.id}`).send({}).expect(400);
    await alice.patch(`/api/v1/documents/${doc.id}`).send({ title: '   ' }).expect(400);
    await alice.patch(`/api/v1/documents/${doc.id}`).send({ tags: 'not-an-array-but-ok,and-b' }).expect(200);
  });

  it('DOC-32 a stranger cannot edit (404)', async () => {
    const doc = await alice.upload();
    await bob.patch(`/api/v1/documents/${doc.id}`).send({ title: 'hacked' }).expect(404);
  });

  it('DOC-33 records an audit trail (created, updated) visible to the owner, newest first', async () => {
    const doc = await alice.upload();
    await alice.patch(`/api/v1/documents/${doc.id}`).send({ title: 'Renamed' }).expect(200);
    const res = await alice.get(`/api/v1/documents/${doc.id}/activity`).expect(200);
    expect(res.body.activity.map((a) => a.action)).toEqual(['document.updated', 'document.created']);
    expect(res.body.activity[0]).toMatchObject({ actor: { id: alice.id }, meta: { fields: ['title'] } });
  });
});
