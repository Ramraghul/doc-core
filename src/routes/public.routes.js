const { Router } = require('express');
const validate = require('../middleware/validate');
const service = require('../services/documentService');
const sendVersion = require('../utils/sendVersion');
const v = require('../validators');

// No authentication: possession of the unguessable, expiring token is the credential.
const router = Router();

router.get('/:token', validate({ params: v.tokenParam }), async (req, res) => {
  const doc = await service.findByPublicToken(req.valid.params.token);
  res.json({
    title: doc.title,
    filename: doc.latest.filename,
    mimeType: doc.latest.mimeType,
    size: doc.latest.size,
    updatedAt: doc.updatedAt,
    expiresAt: doc.publicLink.expiresAt,
  });
});

router.get('/:token/download', validate({ params: v.tokenParam }), async (req, res, next) => {
  const doc = await service.findByPublicToken(req.valid.params.token);
  const version = doc.versions.find((x) => x.version === doc.currentVersion);
  await service.recordPublicDownload(doc);
  sendVersion(res, next, version);
});

module.exports = router;
