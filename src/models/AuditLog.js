const mongoose = require('mongoose');
const applyToJSON = require('../utils/toJSON');

const { Schema } = mongoose;

const ACTIONS = [
  'document.created',
  'document.updated',
  'document.version_added',
  'document.version_pruned',
  'document.downloaded',
  'document.shared',
  'document.unshared',
  'document.trashed',
  'document.restored',
  'document.purged',
  'document.link_created',
  'document.link_revoked',
  'document.public_downloaded',
];

const auditLogSchema = new Schema(
  {
    // No `ref`/cascade: the trail intentionally outlives the document it describes.
    document: { type: Schema.Types.ObjectId, required: true },
    documentTitle: { type: String },
    actor: { type: Schema.Types.ObjectId, ref: 'User' }, // absent for anonymous public-link downloads
    action: { type: String, enum: ACTIONS, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ document: 1, createdAt: -1 });

applyToJSON(auditLogSchema);

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.ACTIONS = ACTIONS;
module.exports = AuditLog;
