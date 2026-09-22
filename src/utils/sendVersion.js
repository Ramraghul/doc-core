const storage = require('../storage/gridfs');
const ApiError = require('./ApiError');

const FILE_HEADERS = ['Content-Disposition', 'Content-Length', 'Content-Type'];

/**
 * Stream one stored version to the client without buffering it in memory.
 * Always sent as an attachment with the type we verified at upload time (never something the
 * browser could render inline), plus `nosniff` from Helmet: uploaded content cannot run as a page.
 */
function sendVersion(res, next, version) {
  const stream = storage.openDownloadStream(version.fileId);

  res.attachment(version.filename); // Content-Disposition with RFC 5987 encoding for non-ASCII names
  res.set({
    'Content-Type': version.mimeType,
    'Content-Length': String(version.size),
    'Cache-Control': 'private, no-store',
  });

  stream.once('error', (err) => {
    if (res.headersSent) return res.destroy(err); // mid-transfer: all we can do is abort the connection
    FILE_HEADERS.forEach((h) => res.removeHeader(h)); // nothing sent yet: fall back to a normal JSON error
    // The metadata says the file exists but GridFS has no blob (e.g. a partially failed delete).
    const missing = err.code === 'ENOENT' || /FileNotFound/i.test(err.message);
    next(missing ? ApiError.notFound('The stored file is missing', 'FILE_MISSING') : err);
  });
  // If the client disconnects, stop pulling chunks out of MongoDB.
  res.once('close', () => stream.destroy());
  stream.pipe(res);
}

module.exports = sendVersion;
