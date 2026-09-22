const { permissionOf, toDocumentDTO, RANK } = require('../../src/services/serializers');

const owner = 'a'.repeat(24);
const editor = 'b'.repeat(24);
const viewer = 'c'.repeat(24);
const stranger = 'd'.repeat(24);

const baseDoc = () => ({
  _id: 'e'.repeat(24),
  owner,
  title: 'T',
  sharedWith: [
    { user: editor, permission: 'editor' },
    { user: viewer, permission: 'viewer' },
  ],
  versions: [{ version: 1, fileId: 'SECRET-FILE-ID' }],
  publicLink: { tokenHash: 'SECRET-HASH', expiresAt: new Date(Date.now() + 1000) },
  latest: { version: 1, filename: 'a.pdf', mimeType: 'application/pdf', size: 1, checksum: 'x', uploadedAt: new Date() },
  currentVersion: 1,
  versionCount: 1,
});

describe('permission model & serialisation', () => {
  it('UT-PRM-01 resolves owner / editor / viewer / none', () => {
    const doc = baseDoc();
    expect(permissionOf(doc, owner)).toBe('owner');
    expect(permissionOf(doc, editor)).toBe('editor');
    expect(permissionOf(doc, viewer)).toBe('viewer');
    expect(permissionOf(doc, stranger)).toBeNull();
  });

  it('UT-PRM-02 works with populated user references', () => {
    const doc = baseDoc();
    doc.owner = { _id: owner, name: 'O' };
    doc.sharedWith = [{ user: { _id: editor, name: 'E' }, permission: 'editor' }];
    expect(permissionOf(doc, owner)).toBe('owner');
    expect(permissionOf(doc, editor)).toBe('editor');
  });

  it('UT-PRM-03 ranks owner > editor > viewer', () => {
    expect(RANK.owner).toBeGreaterThan(RANK.editor);
    expect(RANK.editor).toBeGreaterThan(RANK.viewer);
  });

  it('UT-PRM-04 never exposes storage ids or hashes, to anyone', () => {
    const json = JSON.stringify(toDocumentDTO(baseDoc(), owner, { detail: true }));
    expect(json).not.toContain('SECRET-FILE-ID');
    expect(json).not.toContain('SECRET-HASH');
    expect(json).not.toContain('fileId');
    expect(json).not.toContain('tokenHash');
  });

  it('UT-PRM-05 hides share list and public-link info from non-owners', () => {
    const asViewer = toDocumentDTO(baseDoc(), viewer, { detail: true });
    expect(asViewer.permission).toBe('viewer');
    expect(asViewer).not.toHaveProperty('sharedWith');
    expect(asViewer).not.toHaveProperty('publicLink');

    const asOwner = toDocumentDTO(baseDoc(), owner, { detail: true });
    expect(asOwner.sharedWith).toHaveLength(2);
    expect(asOwner.publicLink.expired).toBe(false);
  });

  it('UT-PRM-06 flags an expired public link for the owner', () => {
    const doc = baseDoc();
    doc.publicLink.expiresAt = new Date(Date.now() - 1000);
    expect(toDocumentDTO(doc, owner).publicLink.expired).toBe(true);
  });
});
