const { Router } = require('express');
const validate = require('../middleware/validate');
const adminService = require('../services/adminService');
const documentService = require('../services/documentService');
const v = require('../validators');

// Mounted behind `authenticate` + `requireRole('admin')`.
// Admin endpoints are operational (stats, accounts, housekeeping); they do not expose document contents.
const router = Router();

router.get('/stats', async (_req, res) => {
  res.json(await adminService.getStats());
});

router.get('/users', validate({ query: v.adminUsersQuery }), async (req, res) => {
  res.json(await adminService.listUsers(req.valid.query));
});

router.post('/purge-trash', async (_req, res) => {
  res.json({ purged: await documentService.purgeExpiredTrash() });
});

module.exports = router;
