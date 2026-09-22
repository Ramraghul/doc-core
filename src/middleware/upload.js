const multer = require('multer');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { resolveMimeType, matchesSignature, sanitizeFilename } = require('../utils/fileTypes');

/**
 * Busboy decodes multipart filenames as latin1, so UTF-8 names ("résumé.pdf") arrive mangled
 * ("rÃ©sumÃ©.pdf"). Re-decode when the bytes round-trip cleanly as UTF-8.
 */
function fixFilenameEncoding(name) {
  if (/[-ÿ]/.test(name) && [...name].every((c) => c.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('�')) return decoded;
  }
  return name;
}

function describeUpload(file) {
  if (!file) throw ApiError.badRequest('A file is required (multipart field "file")', 'FILE_REQUIRED');
  if (file.size === 0) throw ApiError.badRequest('The uploaded file is empty', 'EMPTY_FILE');

  const filename = sanitizeFilename(fixFilenameEncoding(file.originalname));
  const mimeType = resolveMimeType(file.mimetype, filename);
  if (!mimeType) {
    throw ApiError.unsupportedMedia(`File type "${file.mimetype || 'unknown'}" is not allowed`, 'UNSUPPORTED_FILE_TYPE');
  }
  if (!matchesSignature(mimeType, file.buffer)) {
    throw ApiError.unsupportedMedia('File content does not match its declared type', 'FILE_CONTENT_MISMATCH');
  }
  return { buffer: file.buffer, filename, mimeType, size: file.size };
}

/**
 * Accepts one file in multipart field `fieldName` (kept in memory — bounded by MAX_FILE_SIZE_MB, which
 * is what makes memory storage safe on a 512 MB free instance) and exposes it as `req.upload`.
 * The multer instance is built per request so the limit follows live config (handy in tests).
 */
const singleFile =
  (fieldName = 'file') =>
  (req, res, next) => {
    const parser = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: config.maxFileBytes, files: 1, fields: 20, fieldSize: 16 * 1024 },
    }).single(fieldName);

    parser(req, res, (err) => {
      if (err) return next(err);
      try {
        req.upload = describeUpload(req.file);
        next();
      } catch (e) {
        next(e);
      }
    });
  };

module.exports = { singleFile, describeUpload };
