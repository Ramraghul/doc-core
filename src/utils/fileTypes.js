/**
 * Upload allow-list + content sniffing.
 *
 * The browser-supplied Content-Type is attacker-controlled, so we (1) only accept types on an
 * explicit allow-list and (2) check the file's leading bytes ("magic numbers") actually match the
 * declared type. HTML/SVG/JS/executables are deliberately not allowed (stored-XSS / malware risk).
 */
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK" + 0x03 0x04 — also the container for .docx/.xlsx/.pptx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc/.xls/.ppt

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// Text formats have no signature; we only require "looks like text" (no NUL bytes, valid UTF-8).
function looksLikeText(buf) {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return false;
  const decode = (bytes) => {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  };
  if (decode(head)) return true;
  // A multi-byte character may have been cut at the 8 KB boundary; tolerate up to 3 trailing bytes.
  return buf.length > head.length && [1, 2, 3].some((cut) => decode(head.subarray(0, head.length - cut)));
}

const TYPES = {
  'application/pdf': { ext: ['pdf'], check: (b) => startsWith(b, ascii('%PDF-')) },
  'image/png': { ext: ['png'], check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  'image/jpeg': { ext: ['jpg', 'jpeg'], check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  'image/gif': { ext: ['gif'], check: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) },
  'image/webp': {
    ext: ['webp'],
    check: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  },
  'application/zip': { ext: ['zip'], check: (b) => startsWith(b, ZIP) },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], check: (b) => startsWith(b, ZIP) },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], check: (b) => startsWith(b, ZIP) },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: ['pptx'], check: (b) => startsWith(b, ZIP) },
  'application/msword': { ext: ['doc'], check: (b) => startsWith(b, OLE) },
  'application/vnd.ms-excel': { ext: ['xls'], check: (b) => startsWith(b, OLE) },
  'application/vnd.ms-powerpoint': { ext: ['ppt'], check: (b) => startsWith(b, OLE) },
  'text/plain': { ext: ['txt', 'log'], check: looksLikeText },
  'text/markdown': { ext: ['md', 'markdown'], check: looksLikeText },
  'text/csv': { ext: ['csv'], check: looksLikeText },
  'application/json': { ext: ['json'], check: looksLikeText },
};

const EXT_TO_MIME = Object.fromEntries(
  Object.entries(TYPES).flatMap(([mime, { ext }]) => ext.map((e) => [e, mime])),
);

const ALLOWED_MIME_TYPES = Object.keys(TYPES);

/**
 * Work out the effective MIME type. Browsers often send `application/octet-stream` (or nothing)
 * for formats like .md, so in that case fall back to the file extension. Returns null if unsupported.
 */
function resolveMimeType(declared, filename = '') {
  const type = (declared || '').split(';')[0].trim().toLowerCase();
  if (TYPES[type]) return type;
  if (type === '' || type === 'application/octet-stream') {
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    return EXT_TO_MIME[ext] || null;
  }
  return null;
}

/** True when the file's actual bytes are consistent with the given (already-resolved) MIME type. */
function matchesSignature(mimeType, buffer) {
  const spec = TYPES[mimeType];
  return Boolean(spec) && buffer.length > 0 && spec.check(buffer);
}

/** Strip path segments and control characters, cap length. The result is only ever a display name. */
function sanitizeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  const cleaned = [...base]
    .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && !'<>:"|?*'.includes(ch))
    .join('')
    .trim()
    .slice(0, 200);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
}

module.exports = { ALLOWED_MIME_TYPES, resolveMimeType, matchesSignature, sanitizeFilename };
