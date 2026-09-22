const v = require('../../src/validators');
const escapeRegex = require('../../src/utils/escapeRegex');
const { paginationMeta } = require('../../src/utils/pagination');
const ApiError = require('../../src/utils/ApiError');

const ok = (schema, input) => {
  const r = schema.safeParse(input);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};
const fails = (schema, input) => !schema.safeParse(input).success;

describe('validators', () => {
  describe('register / login', () => {
    it('UT-VAL-01 normalises email (trim + lowercase)', () => {
      const data = ok(v.register, { name: 'Ada', email: '  ADA@Example.COM ', password: 'Passw0rd1' });
      expect(data.email).toBe('ada@example.com');
    });

    it.each([
      ['too short', 'Ab1'],
      ['no digit', 'OnlyLetters'],
      ['no letter', '12345678'],
      ['over 72 bytes (bcrypt limit)', `A1${'x'.repeat(80)}`],
    ])('UT-VAL-02 rejects a password that is %s', (_label, password) => {
      expect(fails(v.register, { name: 'Ada', email: 'a@b.co', password })).toBe(true);
    });

    it('UT-VAL-03 rejects bad email, short name, and non-string (NoSQL-operator) values', () => {
      expect(fails(v.register, { name: 'Ada', email: 'nope', password: 'Passw0rd1' })).toBe(true);
      expect(fails(v.register, { name: 'A', email: 'a@b.co', password: 'Passw0rd1' })).toBe(true);
      expect(fails(v.login, { email: { $ne: null }, password: { $ne: null } })).toBe(true);
    });
  });

  describe('tags', () => {
    it('UT-VAL-04 accepts a comma-separated string (multipart form) and de-duplicates / lowercases', () => {
      expect(ok(v.createDocument, { tags: 'Invoice, 2026,invoice,,' }).tags).toEqual(['invoice', '2026']);
    });

    it('UT-VAL-05 accepts arrays and repeated fields', () => {
      expect(ok(v.createDocument, { tags: ['a', 'b,c'] }).tags).toEqual(['a', 'b', 'c']);
    });

    it('UT-VAL-06 defaults to [] on create but stays undefined on update (so PATCH does not wipe tags)', () => {
      expect(ok(v.createDocument, {}).tags).toEqual([]);
      expect(ok(v.updateDocument, { title: 'x' }).tags).toBeUndefined();
    });

    it('UT-VAL-07 enforces limits (max 10 tags, 30 chars, allowed characters)', () => {
      expect(fails(v.createDocument, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toBe(true);
      expect(fails(v.createDocument, { tags: 'x'.repeat(31) })).toBe(true);
      expect(fails(v.createDocument, { tags: '<script>' })).toBe(true);
    });
  });

  describe('document bodies & queries', () => {
    it('UT-VAL-08 update requires at least one field', () => {
      expect(fails(v.updateDocument, {})).toBe(true);
      expect(ok(v.updateDocument, { description: '' }).description).toBe('');
    });

    it('UT-VAL-09 list query applies defaults and coerces numbers', () => {
      const q = ok(v.listDocuments, { page: '2', limit: '10' });
      expect(q).toMatchObject({ scope: 'all', sort: 'updatedAt', order: 'desc', page: 2, limit: 10 });
    });

    it('UT-VAL-10 list query rejects out-of-range paging, unknown enums and injected objects', () => {
      expect(fails(v.listDocuments, { limit: '101' })).toBe(true);
      expect(fails(v.listDocuments, { page: '0' })).toBe(true);
      expect(fails(v.listDocuments, { scope: 'everything' })).toBe(true);
      expect(fails(v.listDocuments, { q: { $ne: '' } })).toBe(true);
    });

    it('UT-VAL-11 ids must be 24-hex ObjectIds', () => {
      expect(ok(v.idParam, { id: 'a'.repeat(24) }).id).toBe('a'.repeat(24));
      for (const id of ['123', 'g'.repeat(24), '../etc', '']) expect(fails(v.idParam, { id })).toBe(true);
    });

    it('UT-VAL-12 public link lifetime defaults to 24h and is bounded to 1..720h', () => {
      expect(ok(v.publicLinkBody, {}).expiresInHours).toBe(24);
      expect(fails(v.publicLinkBody, { expiresInHours: 0 })).toBe(true);
      expect(fails(v.publicLinkBody, { expiresInHours: 721 })).toBe(true);
      expect(fails(v.publicLinkBody, { expiresInHours: 1.5 })).toBe(true);
    });

    it('UT-VAL-13 share body only allows viewer|editor', () => {
      expect(ok(v.shareBody, { email: 'A@B.co', permission: 'editor' }).email).toBe('a@b.co');
      expect(fails(v.shareBody, { email: 'a@b.co', permission: 'owner' })).toBe(true);
    });
  });
});

describe('small utilities', () => {
  it('UT-UTL-01 escapeRegex neutralises regex metacharacters', () => {
    const input = '.*+?^${}()|[]\\';
    expect(new RegExp(escapeRegex(input)).test(input)).toBe(true);
    expect(new RegExp(escapeRegex('a.c')).test('abc')).toBe(false);
  });

  it('UT-UTL-02 paginationMeta computes totalPages (min 1)', () => {
    expect(paginationMeta({ page: 1, limit: 20, total: 0 }).totalPages).toBe(1);
    expect(paginationMeta({ page: 2, limit: 20, total: 41 }).totalPages).toBe(3);
  });

  it('UT-UTL-03 ApiError factories carry status, code and details', () => {
    expect(ApiError.notFound('x').status).toBe(404);
    expect(ApiError.gone('x').status).toBe(410);
    expect(ApiError.conflict('x', 'C').code).toBe('C');
    expect(ApiError.validation([{ path: 'a' }]).details).toEqual([{ path: 'a' }]);
    expect(ApiError.unsupportedMedia('x').status).toBe(415);
    expect(ApiError.tooLarge('x').status).toBe(413);
  });
});
