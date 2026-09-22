const mongoose = require('mongoose');
const applyToJSON = require('../utils/toJSON');

const { Schema } = mongoose;

/** One immutable uploaded file. The bytes live in GridFS (`fileId`); this is its metadata. */
const versionSchema = new Schema(
  {
    version: { type: Number, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true }, // SHA-256 hex of the file bytes
    comment: { type: String, default: '', maxlength: 500 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const shareSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: ['viewer', 'editor'], required: true },
    sharedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const documentSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    tags: { type: [String], default: [] },

    versions: { type: [versionSchema], default: [] },
    // Monotonic counter (never reused, even when old versions are pruned by the retention policy).
    currentVersion: { type: Number, default: 0 },
    versionCount: { type: Number, default: 0 },
    // Denormalised copy of the newest version so lists/filters/sorts do not need to touch `versions`.
    latest: {
      version: Number,
      filename: String,
      mimeType: String,
      size: Number,
      checksum: String,
      uploadedAt: Date,
    },

    sharedWith: { type: [shareSchema], default: [] },

    // Only a SHA-256 hash of the public token is stored, so a DB leak does not expose working links.
    publicLink: {
      tokenHash: String,
      expiresAt: Date,
      createdAt: Date,
    },

    deletedAt: { type: Date, default: null }, // soft delete (trash)
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// List queries: "my documents, newest first" and "documents shared with me".
documentSchema.index({ owner: 1, deletedAt: 1, updatedAt: -1 });
documentSchema.index({ 'sharedWith.user': 1, deletedAt: 1, updatedAt: -1 });
documentSchema.index({ 'publicLink.tokenHash': 1 }, { sparse: true });
// Lets the trash purge job find expired items without a collection scan.
documentSchema.index({ deletedAt: 1 }, { sparse: true });

applyToJSON(documentSchema, ['publicLink']);

module.exports = mongoose.model('Document', documentSchema);
