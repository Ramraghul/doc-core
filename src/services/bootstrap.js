const bcrypt = require('bcryptjs');
const config = require('../config/env');
const User = require('../models/User');
const Document = require('../models/Document');
const documentService = require('./documentService');
const logger = require('../utils/logger');

/** Idempotent: create the admin if missing, promote if the account already exists. Never resets a password. */
async function ensureAdmin({ email, password } = config.admin) {
  if (!email || !password) return null;
  const normalized = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalized });
  if (!user) {
    user = await User.create({
      name: 'Administrator',
      email: normalized,
      passwordHash: await bcrypt.hash(password, config.bcryptRounds),
      role: 'admin',
    });
    logger.info({ email: normalized }, 'Created admin account');
  } else if (user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
    logger.info({ email: normalized }, 'Promoted existing account to admin');
  }
  return user;
}

const SAMPLE_FILES = [
  {
    filename: 'Welcome to Docucore.md',
    mimeType: 'text/markdown',
    title: 'Welcome to Docucore',
    description: 'A short tour of what you can do here.',
    tags: ['guide', 'sample'],
    body: [
      '# Welcome to Docucore',
      '',
      '- **Upload** any PDF, image, Office file or text document (up to the configured size limit).',
      '- **Version it**: upload a new file to the same document and every previous version is kept.',
      '- **Share** with another user as viewer or editor, or create an expiring public link.',
      '- **Trash & restore**: deleted documents are recoverable until they are purged.',
      '',
      'Open the Swagger docs at `/api-docs` to explore the REST API behind this page.',
    ].join('\n'),
  },
  {
    filename: 'q3-budget.csv',
    mimeType: 'text/csv',
    title: 'Q3 budget',
    description: 'Sample spreadsheet data.',
    tags: ['finance', 'sample'],
    body: 'department,planned,actual\nEngineering,120000,118500\nMarketing,45000,47250\nOperations,30000,28900\n',
  },
  {
    filename: 'meeting-notes.txt',
    mimeType: 'text/plain',
    title: 'Architecture meeting notes',
    description: 'Decisions from the design review.',
    tags: ['notes', 'sample'],
    body: 'Decisions\n- Store files in GridFS so the app is stateless.\n- JWT auth, bcrypt password hashing.\n- Keep the last N versions of each document.\n',
  },
];

/** Create the public demo account (and a few sample documents the first time) so visitors see content immediately. */
async function ensureDemo({ email, password } = config.demo) {
  if (!email || !password) return null;
  const normalized = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalized });
  if (!user) {
    user = await User.create({
      name: 'Demo User',
      email: normalized,
      passwordHash: await bcrypt.hash(password, config.bcryptRounds),
    });
    logger.info({ email: normalized }, 'Created demo account');
  }

  if ((await Document.countDocuments({ owner: user._id })) === 0) {
    const actor = { id: String(user._id), role: user.role };
    for (const s of SAMPLE_FILES) {
      const buffer = Buffer.from(s.body, 'utf8');
      await documentService.createDocument(
        actor,
        { buffer, filename: s.filename, mimeType: s.mimeType, size: buffer.length },
        { title: s.title, description: s.description, tags: s.tags },
      );
    }
    logger.info({ email: normalized }, 'Seeded demo documents');
  }
  return user;
}

async function bootstrap() {
  await ensureAdmin();
  await ensureDemo();
}

module.exports = { bootstrap, ensureAdmin, ensureDemo };
