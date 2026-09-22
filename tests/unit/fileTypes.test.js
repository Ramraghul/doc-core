const { resolveMimeType, matchesSignature, sanitizeFilename, ALLOWED_MIME_TYPES } = require('../../src/utils/fileTypes');

describe('fileTypes (upload allow-list & content sniffing)', () => {
  describe('resolveMimeType', () => {
    it('UT-FT-01 accepts an allow-listed declared type and strips charset parameters', () => {
      expect(resolveMimeType('application/pdf', 'x.pdf')).toBe('application/pdf');
      expect(resolveMimeType('Text/Plain; charset=utf-8', 'x.txt')).toBe('text/plain');
    });

    it('UT-FT-02 falls back to the extension for octet-stream or empty types', () => {
      expect(resolveMimeType('application/octet-stream', 'notes.md')).toBe('text/markdown');
      expect(resolveMimeType('', 'data.CSV')).toBe('text/csv');
      expect(resolveMimeType(undefined, 'photo.jpeg')).toBe('image/jpeg');
    });

    it('UT-FT-03 rejects types that are not on the allow-list (html, svg, js, exe)', () => {
      for (const type of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload']) {
        expect(resolveMimeType(type, 'x.bin')).toBeNull();
      }
    });

    it('UT-FT-04 does not trust the extension when a specific unsupported type is declared', () => {
      expect(resolveMimeType('text/html', 'looks-innocent.txt')).toBeNull();
    });

    it('UT-FT-05 returns null for octet-stream with an unknown or missing extension', () => {
      expect(resolveMimeType('application/octet-stream', 'archive.exe')).toBeNull();
      expect(resolveMimeType('application/octet-stream', 'noextension')).toBeNull();
    });
  });

  describe('matchesSignature', () => {
    const cases = {
      'application/pdf': Buffer.from('%PDF-1.7 rest'),
      'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]),
      'image/gif': Buffer.from('GIF89a....'),
      'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]),
      'application/zip': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]),
      'application/msword': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
    };

    it.each(Object.entries(cases))('UT-FT-06 accepts a genuine %s file', (mime, buf) => {
      expect(matchesSignature(mime, buf)).toBe(true);
    });

    it('UT-FT-07 rejects content that does not match the declared type', () => {
      const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
      expect(matchesSignature('application/pdf', exe)).toBe(false);
      expect(matchesSignature('image/png', Buffer.from('%PDF-1.4'))).toBe(false);
      expect(matchesSignature('application/zip', Buffer.from('not a zip'))).toBe(false);
    });

    it('UT-FT-08 rejects empty buffers and unknown types', () => {
      expect(matchesSignature('application/pdf', Buffer.alloc(0))).toBe(false);
      expect(matchesSignature('text/html', Buffer.from('<html>'))).toBe(false);
    });

    it('UT-FT-09 treats valid UTF-8 as text (including multi-byte characters)', () => {
      expect(matchesSignature('text/plain', Buffer.from('héllo wörld — 你好'))).toBe(true);
      expect(matchesSignature('text/csv', Buffer.from('a,b\n1,2\n'))).toBe(true);
    });

    it('UT-FT-10 rejects "text" that contains NUL bytes or invalid UTF-8', () => {
      expect(matchesSignature('text/plain', Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
      expect(matchesSignature('text/plain', Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
    });

    it('UT-FT-11 tolerates a multi-byte character cut in half at the 8 KB sniff boundary', () => {
      // 8191 ASCII bytes + a 2-byte char straddling the boundary, then more text
      const buf = Buffer.concat([Buffer.alloc(8191, 'a'), Buffer.from('é'), Buffer.from(' tail')]);
      expect(matchesSignature('text/plain', buf)).toBe(true);
    });
  });

  describe('sanitizeFilename', () => {
    it('UT-FT-12 strips directory components (path traversal)', () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('C:\\Users\\bob\\report.pdf')).toBe('report.pdf');
    });

    it('UT-FT-13 removes control characters and reserved symbols', () => {
      expect(sanitizeFilename('bad\u0000na\nme<>:"|?*.txt')).toBe('badname.txt');
    });

    it('UT-FT-14 falls back to "file" for empty or dot-only names', () => {
      for (const name of ['', '   ', '.', '..', undefined, null]) expect(sanitizeFilename(name)).toBe('file');
    });

    it('UT-FT-15 caps very long names at 200 characters and keeps unicode', () => {
      expect(sanitizeFilename('a'.repeat(500))).toHaveLength(200);
      expect(sanitizeFilename('résumé 履歴書.pdf')).toBe('résumé 履歴書.pdf');
    });
  });

  it('UT-FT-16 never allow-lists active content types', () => {
    for (const bad of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-sh']) {
      expect(ALLOWED_MIME_TYPES).not.toContain(bad);
    }
  });
});
