const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * File-byte storage on MongoDB GridFS.
 *
 * Why GridFS: free hosts (Render, Koyeb, ...) have an ephemeral disk that is wiped on every
 * deploy/restart, and free object storage usually needs a card. GridFS keeps files in the same
 * free Atlas database as the metadata. To move to S3/R2 later, only this module has to change:
 * it exposes put / openDownloadStream / remove and nothing else leaks the storage engine.
 */
const buckets = new WeakMap(); // one bucket per live connection (test suites reconnect often)

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  if (!buckets.has(db)) buckets.set(db, new mongoose.mongo.GridFSBucket(db, { bucketName: 'documents' }));
  return buckets.get(db);
}

/** Store a buffer, resolve with the new file's ObjectId. */
function put(buffer, { filename, mimeType }) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata: { mimeType } });
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

function openDownloadStream(fileId) {
  return bucket().openDownloadStream(fileId);
}

/** Best-effort delete: a missing file is fine, anything else is logged but never breaks the request. */
async function remove(fileId) {
  try {
    await bucket().delete(fileId);
  } catch (err) {
    logger.warn({ err, fileId: String(fileId) }, 'GridFS delete failed');
  }
}

module.exports = { put, openDownloadStream, remove };
