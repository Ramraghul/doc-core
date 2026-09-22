/**
 * Turns database documents into the public API shape. Everything the client sees goes through here,
 * so internal fields (GridFS ids, public-link hashes, other users' share lists) cannot leak by accident.
 */
const idOf = (ref) => String(ref?._id ?? ref);

const RANK = { viewer: 1, editor: 2, owner: 3 };

/** 'owner' | 'editor' | 'viewer' | null for a given user on a document (works with populated refs). */
function permissionOf(doc, userId) {
  const uid = String(userId);
  if (idOf(doc.owner) === uid) return 'owner';
  const share = (doc.sharedWith || []).find((s) => idOf(s.user) === uid);
  return share ? share.permission : null;
}

const userRef = (u) => {
  if (!u) return null;
  return u._id ? { id: String(u._id), name: u.name, email: u.email } : { id: String(u) };
};

const plain = (doc) => (typeof doc.toObject === 'function' ? doc.toObject() : doc);

function toVersionDTO(v, currentVersion) {
  return {
    version: v.version,
    filename: v.filename,
    mimeType: v.mimeType,
    size: v.size,
    checksum: v.checksum,
    comment: v.comment || '',
    uploadedBy: userRef(v.uploadedBy),
    uploadedAt: v.uploadedAt,
    isCurrent: v.version === currentVersion,
  };
}

function toDocumentDTO(input, viewerId, { detail = false } = {}) {
  const d = plain(input);
  const permission = permissionOf(d, viewerId);

  const dto = {
    id: String(d._id),
    title: d.title,
    description: d.description || '',
    tags: d.tags || [],
    owner: userRef(d.owner),
    permission,
    latest: d.latest?.filename
      ? {
          version: d.latest.version,
          filename: d.latest.filename,
          mimeType: d.latest.mimeType,
          size: d.latest.size,
          checksum: d.latest.checksum,
          uploadedAt: d.latest.uploadedAt,
        }
      : null,
    currentVersion: d.currentVersion,
    versionCount: d.versionCount,
    sharedWithCount: (d.sharedWith || []).length,
    deletedAt: d.deletedAt || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };

  // Sharing internals are for the owner's eyes only.
  if (permission === 'owner') {
    dto.publicLink = d.publicLink?.expiresAt
      ? { expiresAt: d.publicLink.expiresAt, expired: new Date(d.publicLink.expiresAt) <= new Date() }
      : null;
    if (detail) {
      dto.sharedWith = (d.sharedWith || []).map((s) => ({
        user: userRef(s.user),
        permission: s.permission,
        sharedAt: s.sharedAt,
      }));
    }
  }
  return dto;
}

module.exports = { RANK, permissionOf, toDocumentDTO, toVersionDTO, userRef };
