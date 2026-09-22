const { z } = require('zod');
const { paginationQuery } = require('../utils/pagination');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character id');

// ---------- auth ----------
const email = z.string().trim().toLowerCase().pipe(z.email('Must be a valid email address').max(254));

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  // bcrypt silently ignores everything after 72 bytes; refuse instead of pretending it was used.
  .refine((v) => Buffer.byteLength(v) <= 72, 'Password must be at most 72 bytes')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

const register = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email,
  password,
});

const login = z.object({ email, password: z.string().min(1).max(128) });

// ---------- documents ----------
const tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30, 'A tag can be at most 30 characters')
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_\- ]*$/u, 'Tags may contain letters, numbers, spaces, "-" and "_"');

/** Accepts ["a","b"], "a,b" (multipart forms) or repeated fields; empty/blank entries are dropped. */
const coerceTags = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');
};
const uniq = (list) => [...new Set(list)];
const tagList = z.array(tag).max(10, 'At most 10 tags').transform(uniq);

const title = z.string().trim().min(1, 'Title cannot be empty').max(200);
const description = z.string().trim().max(2000);

const createDocument = z.object({
  title: title.optional(),
  description: description.optional(),
  tags: z.preprocess(coerceTags, tagList.default([])),
});

const updateDocument = z
  .object({
    title: title.optional(),
    description: description.optional(),
    tags: z.preprocess(coerceTags, tagList.optional()),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined || v.tags !== undefined, {
    message: 'Provide at least one of: title, description, tags',
  });

const addVersion = z.object({ comment: z.string().trim().max(500).optional() });

const listDocuments = z.object({
  scope: z.enum(['all', 'owned', 'shared', 'trash']).default('all'),
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  mimeType: z.string().trim().max(120).optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'title', 'size']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  ...paginationQuery,
});

const downloadQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

const idParam = z.object({ id: objectId });
const shareParams = z.object({ id: objectId, userId: objectId });
const tokenParam = z.object({ token: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/) });

const shareBody = z.object({ email, permission: z.enum(['viewer', 'editor']) });
const publicLinkBody = z.object({ expiresInHours: z.number().int().min(1).max(720).default(24) });
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const adminUsersQuery = z.object({ ...paginationQuery });

module.exports = {
  register,
  login,
  createDocument,
  updateDocument,
  addVersion,
  listDocuments,
  downloadQuery,
  idParam,
  shareParams,
  tokenParam,
  shareBody,
  publicLinkBody,
  activityQuery,
  adminUsersQuery,
};
