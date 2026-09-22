const User = require('../models/User');
const Document = require('../models/Document');
const config = require('../config/env');
const { getUsage } = require('./usageService');
const { paginationMeta } = require('../utils/pagination');

async function getStats() {
  const [users, documents, trashed, [storage]] = await Promise.all([
    User.countDocuments(),
    Document.countDocuments({ deletedAt: null }),
    Document.countDocuments({ deletedAt: { $ne: null } }),
    Document.aggregate([
      { $unwind: '$versions' },
      { $group: { _id: null, bytes: { $sum: '$versions.size' }, versions: { $sum: 1 } } },
    ]),
  ]);
  return {
    users,
    documents,
    trashed,
    versions: storage?.versions ?? 0,
    storageBytes: storage?.bytes ?? 0,
    limits: {
      maxFileBytes: config.maxFileBytes,
      userQuotaBytes: config.quotaBytes,
      maxVersionsPerDocument: config.maxVersions,
      trashRetentionDays: config.trashRetentionDays,
    },
  };
}

async function listUsers({ page, limit }) {
  const [users, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(),
  ]);
  const data = await Promise.all(
    users.map(async (u) => ({ ...u.toJSON(), usage: await getUsage(u._id) })),
  );
  return { data, meta: paginationMeta({ page, limit, total }) };
}

module.exports = { getStats, listUsers };
