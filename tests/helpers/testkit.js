const mongoose = require('mongoose');
const request = require('supertest');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');

// ---- tiny valid-looking files (magic numbers are what the upload check inspects) ----
const files = {
  pdf: (extra = '') => Buffer.from(`%PDF-1.4\n% docucore test ${extra}\n%%EOF`),
  png: (extra = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra || 'png')]),
  text: (s = 'hello docucore') => Buffer.from(s),
  html: () => Buffer.from('<html><script>alert(1)</script></html>'),
  exe: () => Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]),
};

async function setup() {
  await connectDb();
  return createApp();
}

async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

async function teardown() {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}

/** superagent parser that keeps binary bodies as a Buffer (use with `.buffer(true).parse(binary)`). */
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

let counter = 0;

/** Registers a user through the real API and returns handy helpers bound to their token. */
async function createUser(app, overrides = {}) {
  counter += 1;
  const body = {
    name: overrides.name || `Test User ${counter}`,
    email: overrides.email || `user${counter}-${Date.now()}@example.com`,
    password: overrides.password || 'Passw0rdTest',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body).expect(201);
  const { token, user } = res.body;
  const auth = { Authorization: `Bearer ${token}` };

  if (overrides.role === 'admin') await User.updateOne({ _id: user.id }, { role: 'admin' });

  return {
    ...user,
    email: body.email,
    password: body.password,
    token,
    auth,
    get: (url) => request(app).get(url).set(auth),
    post: (url) => request(app).post(url).set(auth),
    patch: (url) => request(app).patch(url).set(auth),
    del: (url) => request(app).delete(url).set(auth),
    /** Upload a new document; returns the document DTO. */
    async upload(buffer = files.pdf(), { filename = 'file.pdf', contentType = 'application/pdf', fields = {} } = {}) {
      let req = request(app).post('/api/v1/documents').set(auth).attach('file', buffer, { filename, contentType });
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      const res = await req.expect(201);
      return res.body.document;
    },
  };
}

module.exports = { setup, teardown, clearDb, createUser, files, binary, request };
