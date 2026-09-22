const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const authService = require('../services/authService');
const { getUsage } = require('../services/usageService');
const v = require('../validators');

const router = Router();

router.post('/register', validate({ body: v.register }), async (req, res) => {
  const { user, token } = await authService.register(req.valid.body);
  res.status(201).json({ token, user });
});

router.post('/login', validate({ body: v.login }), async (req, res) => {
  const { user, token } = await authService.login(req.valid.body);
  res.json({ token, user });
});

router.get('/me', authenticate, async (req, res) => {
  const { id, name, email, role } = req.user;
  res.json({ user: { id, name, email, role }, usage: await getUsage(id) });
});

module.exports = router;
