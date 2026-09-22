const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * Append-only activity trail. A failure to write an audit entry is logged but never fails the
 * user's action (the action has already happened by the time we record it).
 */
async function record(doc, actorId, action, meta) {
  try {
    await AuditLog.create({
      document: doc._id,
      documentTitle: doc.title,
      actor: actorId || undefined,
      action,
      meta,
    });
  } catch (err) {
    logger.error({ err, action, document: String(doc._id) }, 'Failed to write audit log');
  }
}

async function listForDocument(documentId, limit = 50) {
  return AuditLog.find({ document: documentId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('actor', 'name email')
    .lean();
}

module.exports = { record, listForDocument };
