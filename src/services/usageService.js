const mongoose = require('mongoose');
const Document = require('../models/Document');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Bytes stored by a user = sum of every retained version of every document they own (trash included,
 * since trashed files still occupy space until purged). Computed on demand instead of kept as a
 * counter, so it can never drift out of sync after a crash or a partial failure.
 */
async function getUsage(userId) {
  const [row] = await Document.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(String(userId)) } },
    { $unwind: '$versions' },
    { $group: { _id: null, usedBytes: { $sum: '$versions.size' }, files: { $sum: 1 } } },
  ]);
  return { usedBytes: row?.usedBytes ?? 0, files: row?.files ?? 0, quotaBytes: config.quotaBytes };
}

async function assertQuota(ownerId, incomingBytes) {
  const { usedBytes, quotaBytes } = await getUsage(ownerId);
  if (usedBytes + incomingBytes > quotaBytes) {
    throw ApiError.tooLarge(
      `Storage quota exceeded (${usedBytes + incomingBytes} of ${quotaBytes} bytes). Delete files permanently to free up space.`,
      'QUOTA_EXCEEDED',
    );
  }
}

module.exports = { getUsage, assertQuota };
