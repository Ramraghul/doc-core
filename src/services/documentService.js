const crypto = require('node:crypto');
const mongoose = require('mongoose');
const config = require('../config/env');
const Document = require('../models/Document');
const User = require('../models/User');
const storage = require('../storage/gridfs');
const audit = require('./auditService');
const { assertQuota } = require('./usageService');
const { RANK, permissionOf, toDocumentDTO, toVersionDTO } = require('./serializers');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const { paginationMeta } = require('../utils/pagination');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const stripExtension = (name) => name.replace(/\.[^./\\]+$/, '') || name;

const toLatest = (v) => ({
  version: v.version,
  filename: v.filename,
  mimeType: v.mimeType,
  size: v.size,
  checksum: v.checksum,
  uploadedAt: v.uploadedAt,
});

// ---------------------------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------------------------

/**
 * Load a document and enforce access in one place.
 *  - No access at all  -> 404 (we never confirm that a document someone else owns exists).
 *  - Access, but not enough (e.g. viewer trying to edit) -> 403.
 *  - Trashed documents are visible to their owner only, and only when `includeTrashed` is set.
 * Administrators get no special access to other users' documents by design.
 */
async function loadDocument(id, user, { need = 'viewer', includeTrashed = false } = {}) {
  const doc = await Document.findById(id);
  if (!doc) throw ApiError.notFound('Document not found', 'DOCUMENT_NOT_FOUND');

  const permission = permissionOf(doc, user.id);
  if (!permission) throw ApiError.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
  if (doc.deletedAt && !(includeTrashed && permission === 'owner')) {
    throw ApiError.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
  }
  if (RANK[permission] < RANK[need]) {
    throw ApiError.forbidden(`This action requires "${need}" access or higher`, 'INSUFFICIENT_PERMISSION');
  }
  return { doc, permission };
}

async function present(doc, user) {
  await doc.populate([
    { path: 'owner', select: 'name email' },
    { path: 'sharedWith.user', select: 'name email' },
  ]);
  return toDocumentDTO(doc, user.id, { detail: true });
}

// ---------------------------------------------------------------------------------------------
// Create / read / update
// ---------------------------------------------------------------------------------------------

async function createDocument(user, upload, meta = {}) {
  await assertQuota(user.id, upload.size);

  const checksum = sha256(upload.buffer);
  const fileId = await storage.put(upload.buffer, upload);
  const now = new Date();
  const version = {
    version: 1,
    fileId,
    filename: upload.filename,
    mimeType: upload.mimeType,
    size: upload.size,
    checksum,
    comment: 'Initial version',
    uploadedBy: user.id,
    uploadedAt: now,
  };

  let doc;
  try {
    doc = await Document.create({
      owner: user.id,
      title: meta.title || stripExtension(upload.filename),
      description: meta.description || '',
      tags: meta.tags || [],
      versions: [version],
      currentVersion: 1,
      versionCount: 1,
      latest: toLatest(version),
    });
  } catch (err) {
    await storage.remove(fileId); // do not leave an orphaned blob behind
    throw err;
  }

  await audit.record(doc, user.id, 'document.created', { filename: upload.filename, size: upload.size });
  return present(doc, user);
}

async function getDocument(user, id) {
  const { doc } = await loadDocument(id, user, { includeTrashed: true });
  return present(doc, user);
}

async function listDocuments(user, query) {
  const { scope, q, tag, mimeType, sort, order, page, limit } = query;
  const me = oid(user.id);
  const clauses = [];

  if (scope === 'trash') {
    clauses.push({ owner: me, deletedAt: { $ne: null } });
  } else {
    clauses.push({ deletedAt: null });
    if (scope === 'owned') clauses.push({ owner: me });
    else if (scope === 'shared') clauses.push({ 'sharedWith.user': me });
    else clauses.push({ $or: [{ owner: me }, { 'sharedWith.user': me }] });
  }
  if (q) {
    // Escaped substring match keeps search predictable for users typing partial words ("inv" -> "Invoice").
    // At larger scale this is where Atlas Search / a text index would replace the regex.
    const rx = new RegExp(escapeRegex(q), 'i');
    clauses.push({ $or: [{ title: rx }, { description: rx }, { tags: rx }, { 'latest.filename': rx }] });
  }
  if (tag) clauses.push({ tags: tag });
  if (mimeType) clauses.push({ 'latest.mimeType': mimeType });

  const filter = { $and: clauses };
  const sortField = sort === 'size' ? 'latest.size' : sort;
  const direction = order === 'asc' ? 1 : -1;

  const [items, total] = await Promise.all([
    Document.find(filter)
      .select('-versions -publicLink.tokenHash')
      .sort({ [sortField]: direction, _id: -1 }) // _id tiebreaker keeps pagination stable
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('owner', 'name email')
      .lean(),
    Document.countDocuments(filter),
  ]);

  return {
    data: items.map((d) => toDocumentDTO(d, user.id)),
    meta: paginationMeta({ page, limit, total }),
  };
}

async function updateMetadata(user, id, patch) {
  const { doc } = await loadDocument(id, user, { need: 'editor' });
  const changed = [];
  for (const field of ['title', 'description', 'tags']) {
    if (patch[field] !== undefined) {
      doc[field] = patch[field];
      changed.push(field);
    }
  }
  await doc.save();
  await audit.record(doc, user.id, 'document.updated', { fields: changed });
  return present(doc, user);
}

// ---------------------------------------------------------------------------------------------
// Versions & downloads
// ---------------------------------------------------------------------------------------------

async function addVersion(user, id, upload, comment) {
  const { doc } = await loadDocument(id, user, { need: 'editor' });

  const checksum = sha256(upload.buffer);
  if (doc.latest?.checksum === checksum) {
    throw ApiError.conflict('This file is identical to the current version', 'DUPLICATE_VERSION');
  }
  // Space is charged to the document's owner, who chose to give this person edit rights.
  await assertQuota(doc.owner, upload.size);

  const fileId = await storage.put(upload.buffer, upload);
  const version = {
    version: doc.currentVersion + 1,
    fileId,
    filename: upload.filename,
    mimeType: upload.mimeType,
    size: upload.size,
    checksum,
    comment: comment || '',
    uploadedBy: user.id,
    uploadedAt: new Date(),
  };

  // Optimistic concurrency: the update only applies if nobody else added a version in the meantime,
  // so two simultaneous uploads can never produce two "version 4"s.
  const updated = await Document.findOneAndUpdate(
    { _id: doc._id, currentVersion: doc.currentVersion, deletedAt: null },
    {
      $push: { versions: version },
      $set: { currentVersion: version.version, latest: toLatest(version) },
      $inc: { versionCount: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!updated) {
    await storage.remove(fileId);
    throw ApiError.conflict('The document was modified at the same time; please retry', 'CONCURRENT_MODIFICATION');
  }

  await audit.record(updated, user.id, 'document.version_added', {
    version: version.version,
    filename: version.filename,
    size: version.size,
  });
  await pruneOldVersions(updated, user.id);
  return present(updated, user);
}

/** Retention policy: keep only the newest MAX_VERSIONS_PER_DOCUMENT versions (bounds storage growth). */
async function pruneOldVersions(doc, actorId) {
  const excess = doc.versions.length - config.maxVersions;
  if (excess <= 0) return;

  const oldest = [...doc.versions].sort((a, b) => a.version - b.version).slice(0, excess);
  await Document.updateOne(
    { _id: doc._id },
    { $pull: { versions: { version: { $in: oldest.map((v) => v.version) } } }, $inc: { versionCount: -oldest.length } },
  );
  await Promise.all(oldest.map((v) => storage.remove(v.fileId)));
  await audit.record(doc, actorId, 'document.version_pruned', { versions: oldest.map((v) => v.version) });
}

async function listVersions(user, id) {
  const { doc } = await loadDocument(id, user);
  await doc.populate('versions.uploadedBy', 'name email');
  return [...doc.toObject().versions]
    .sort((a, b) => b.version - a.version)
    .map((v) => toVersionDTO(v, doc.currentVersion));
}

/** Resolve which stored file to send. Returns what the route needs to stream it. */
async function prepareDownload(user, id, versionNumber) {
  const { doc } = await loadDocument(id, user);
  const wanted = versionNumber ?? doc.currentVersion;
  const version = doc.versions.find((v) => v.version === wanted);
  if (!version) throw ApiError.notFound(`Version ${wanted} does not exist`, 'VERSION_NOT_FOUND');

  await audit.record(doc, user.id, 'document.downloaded', { version: version.version });
  return version;
}

// ---------------------------------------------------------------------------------------------
// Trash / restore / permanent delete
// ---------------------------------------------------------------------------------------------

async function trashDocument(user, id) {
  const { doc } = await loadDocument(id, user, { need: 'owner' });
  doc.deletedAt = new Date();
  doc.deletedBy = user.id;
  await doc.save();
  await audit.record(doc, user.id, 'document.trashed');
}

async function restoreDocument(user, id) {
  const { doc } = await loadDocument(id, user, { need: 'owner', includeTrashed: true });
  if (!doc.deletedAt) throw ApiError.conflict('Document is not in the trash', 'NOT_IN_TRASH');
  doc.deletedAt = null;
  doc.deletedBy = undefined;
  await doc.save();
  await audit.record(doc, user.id, 'document.restored');
  return present(doc, user);
}

/** Remove the record first, then the blobs: a crash in between leaves harmless orphans, never dangling refs. */
async function purge(doc, actorId) {
  await Document.deleteOne({ _id: doc._id });
  await Promise.all(doc.versions.map((v) => storage.remove(v.fileId)));
  await audit.record(doc, actorId, 'document.purged', { versions: doc.versions.length });
}

async function permanentlyDelete(user, id) {
  const { doc } = await loadDocument(id, user, { need: 'owner', includeTrashed: true });
  if (!doc.deletedAt) {
    throw ApiError.conflict('Move the document to the trash before deleting it permanently', 'NOT_IN_TRASH');
  }
  await purge(doc, user.id);
}

/** Purge everything that has sat in the trash longer than the retention window. Returns how many. */
async function purgeExpiredTrash(retentionDays = config.trashRetentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = await Document.find({ deletedAt: { $ne: null, $lte: cutoff } });
  for (const doc of expired) await purge(doc, null);
  return expired.length;
}

// ---------------------------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------------------------

async function shareDocument(user, id, { email, permission }) {
  const { doc } = await loadDocument(id, user, { need: 'owner' });

  const target = await User.findOne({ email }).lean();
  if (!target) throw ApiError.notFound('No user with that email address', 'USER_NOT_FOUND');
  if (String(target._id) === String(doc.owner)) {
    throw ApiError.badRequest('You already own this document', 'CANNOT_SHARE_WITH_OWNER');
  }

  const existing = doc.sharedWith.find((s) => String(s.user) === String(target._id));
  if (existing) existing.permission = permission;
  else doc.sharedWith.push({ user: target._id, permission });
  await doc.save();

  await audit.record(doc, user.id, 'document.shared', { with: target.email, permission });
  return present(doc, user);
}

async function unshareDocument(user, id, targetUserId) {
  const { doc } = await loadDocument(id, user, { need: 'owner' });
  const before = doc.sharedWith.length;
  doc.sharedWith = doc.sharedWith.filter((s) => String(s.user) !== String(targetUserId));
  if (doc.sharedWith.length === before) throw ApiError.notFound('Document is not shared with that user', 'SHARE_NOT_FOUND');
  await doc.save();
  await audit.record(doc, user.id, 'document.unshared', { user: String(targetUserId) });
  return present(doc, user);
}

// ---------------------------------------------------------------------------------------------
// Public links (anonymous, expiring, revocable)
// ---------------------------------------------------------------------------------------------

async function createPublicLink(user, id, expiresInHours) {
  const { doc } = await loadDocument(id, user, { need: 'owner' });

  // 256 bits of randomness; only its hash is stored, so the token can be shown exactly once.
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  doc.publicLink = { tokenHash: sha256(token), expiresAt, createdAt: new Date() };
  await doc.save();

  await audit.record(doc, user.id, 'document.link_created', { expiresAt });
  return { token, expiresAt };
}

async function revokePublicLink(user, id) {
  const { doc } = await loadDocument(id, user, { need: 'owner' });
  if (!doc.publicLink?.tokenHash) throw ApiError.notFound('This document has no public link', 'LINK_NOT_FOUND');
  doc.publicLink = undefined;
  await doc.save();
  await audit.record(doc, user.id, 'document.link_revoked');
}

/** Resolve a public token to its document, or throw 404 (unknown / trashed) or 410 (expired). */
async function findByPublicToken(token) {
  const doc = await Document.findOne({ 'publicLink.tokenHash': sha256(token), deletedAt: null });
  if (!doc) throw ApiError.notFound('This link is invalid or has been revoked', 'LINK_NOT_FOUND');
  if (doc.publicLink.expiresAt <= new Date()) throw ApiError.gone('This link has expired', 'LINK_EXPIRED');
  return doc;
}

async function recordPublicDownload(doc) {
  await audit.record(doc, null, 'document.public_downloaded', { version: doc.currentVersion });
}

async function listActivity(user, id, limit) {
  const { doc } = await loadDocument(id, user, { need: 'editor', includeTrashed: true });
  const rows = await audit.listForDocument(doc._id, limit);
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action,
    actor: r.actor ? { id: String(r.actor._id), name: r.actor.name, email: r.actor.email } : null,
    meta: r.meta ?? null,
    createdAt: r.createdAt,
  }));
}

module.exports = {
  loadDocument,
  createDocument,
  getDocument,
  listDocuments,
  updateMetadata,
  addVersion,
  listVersions,
  prepareDownload,
  trashDocument,
  restoreDocument,
  permanentlyDelete,
  purgeExpiredTrash,
  shareDocument,
  unshareDocument,
  createPublicLink,
  revokePublicLink,
  findByPublicToken,
  recordPublicDownload,
  listActivity,
};
