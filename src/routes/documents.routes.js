const { Router } = require('express');
const validate = require('../middleware/validate');
const { singleFile } = require('../middleware/upload');
const service = require('../services/documentService');
const sendVersion = require('../utils/sendVersion');
const v = require('../validators');

// Mounted behind `authenticate`, so `req.user` is always set here.
const router = Router();

router.post('/', singleFile(), validate({ body: v.createDocument }), async (req, res) => {
  const doc = await service.createDocument(req.user, req.upload, req.valid.body);
  res.status(201).json({ document: doc });
});

router.get('/', validate({ query: v.listDocuments }), async (req, res) => {
  res.json(await service.listDocuments(req.user, req.valid.query));
});

router.get('/:id', validate({ params: v.idParam }), async (req, res) => {
  res.json({ document: await service.getDocument(req.user, req.valid.params.id) });
});

router.patch('/:id', validate({ params: v.idParam, body: v.updateDocument }), async (req, res) => {
  res.json({ document: await service.updateMetadata(req.user, req.valid.params.id, req.valid.body) });
});

// Soft delete: moves to the trash (recoverable). Permanent removal is a separate, explicit call.
router.delete('/:id', validate({ params: v.idParam }), async (req, res) => {
  await service.trashDocument(req.user, req.valid.params.id);
  res.status(204).end();
});

router.post('/:id/restore', validate({ params: v.idParam }), async (req, res) => {
  res.json({ document: await service.restoreDocument(req.user, req.valid.params.id) });
});

router.delete('/:id/permanent', validate({ params: v.idParam }), async (req, res) => {
  await service.permanentlyDelete(req.user, req.valid.params.id);
  res.status(204).end();
});

// ---- versions & download ----
router.get('/:id/versions', validate({ params: v.idParam }), async (req, res) => {
  res.json({ versions: await service.listVersions(req.user, req.valid.params.id) });
});

router.post(
  '/:id/versions',
  singleFile(),
  validate({ params: v.idParam, body: v.addVersion }),
  async (req, res) => {
    const doc = await service.addVersion(req.user, req.valid.params.id, req.upload, req.valid.body.comment);
    res.status(201).json({ document: doc });
  },
);

router.get('/:id/download', validate({ params: v.idParam, query: v.downloadQuery }), async (req, res, next) => {
  const version = await service.prepareDownload(req.user, req.valid.params.id, req.valid.query.version);
  sendVersion(res, next, version);
});

// ---- sharing ----
router.post('/:id/shares', validate({ params: v.idParam, body: v.shareBody }), async (req, res) => {
  res.status(201).json({ document: await service.shareDocument(req.user, req.valid.params.id, req.valid.body) });
});

router.delete('/:id/shares/:userId', validate({ params: v.shareParams }), async (req, res) => {
  const { id, userId } = req.valid.params;
  res.json({ document: await service.unshareDocument(req.user, id, userId) });
});

router.post('/:id/public-link', validate({ params: v.idParam, body: v.publicLinkBody }), async (req, res) => {
  const { token, expiresAt } = await service.createPublicLink(req.user, req.valid.params.id, req.valid.body.expiresInHours);
  res.status(201).json({ token, expiresAt, path: `/api/v1/public/${token}/download` });
});

router.delete('/:id/public-link', validate({ params: v.idParam }), async (req, res) => {
  await service.revokePublicLink(req.user, req.valid.params.id);
  res.status(204).end();
});

// ---- audit trail ----
router.get('/:id/activity', validate({ params: v.idParam, query: v.activityQuery }), async (req, res) => {
  res.json({ activity: await service.listActivity(req.user, req.valid.params.id, req.valid.query.limit) });
});

module.exports = router;
