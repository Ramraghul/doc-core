const jwt = require('jsonwebtoken');
const config = require('../../src/config/env');
const User = require('../../src/models/User');
const { setup, teardown, clearDb, createUser, request } = require('../helpers/testkit');

let app;
beforeAll(async () => { app = await setup(); });
afterAll(teardown);
beforeEach(clearDb);

const valid = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Passw0rd123' };

describe('Auth', () => {
  it('AUTH-01 registers a user, returns 201 with a JWT and a public user (no password hash)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', role: 'user' });
    expect(res.body.user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Passw0rd123/);
  });

  it('AUTH-02 normalises the email (trim + lowercase)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...valid, email: '  ADA@Example.COM ' }).expect(201);
    expect(res.body.user.email).toBe('ada@example.com');
  });

  it('AUTH-03 rejects a duplicate email (case-insensitive) with 409 EMAIL_TAKEN', async () => {
    await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    const res = await request(app).post('/api/v1/auth/register').send({ ...valid, email: 'ADA@example.com' }).expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('AUTH-04 returns field-level validation details for bad input', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'A', email: 'nope', password: 'short' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('AUTH-05 blocks NoSQL-injection payloads on login', async () => {
    await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    const res = await request(app).post('/api/v1/auth/login').send({ email: { $ne: null }, password: { $ne: null } }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AUTH-06 logs in with correct credentials and the token works on /auth/me', async () => {
    await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ADA@example.com', password: valid.password }).expect(200);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(me.body.user.email).toBe('ada@example.com');
  });

  it('AUTH-07 gives the same 401 for a wrong password and an unknown email (no account enumeration)', async () => {
    await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    const wrongPw = await request(app).post('/api/v1/auth/login').send({ email: valid.email, password: 'WrongPass123' }).expect(401);
    const noUser = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'WrongPass123' }).expect(401);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(noUser.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('AUTH-08 stores only a bcrypt hash of the password', async () => {
    await request(app).post('/api/v1/auth/register').send(valid).expect(201);
    const stored = await User.findOne({ email: valid.email }).select('+passwordHash');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain(valid.password);
  });

  it('AUTH-09 rejects requests without / with malformed tokens', async () => {
    const none = await request(app).get('/api/v1/auth/me').expect(401);
    expect(none.body.error.code).toBe('UNAUTHORIZED');
    const bad = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    expect(bad.body.error.code).toBe('INVALID_TOKEN');
    await request(app).get('/api/v1/auth/me').set('Authorization', 'Basic abc').expect(401);
  });

  it('AUTH-10 rejects an expired token with TOKEN_EXPIRED', async () => {
    const user = await createUser(app);
    const expired = jwt.sign({ role: 'user' }, config.jwt.secret, { subject: user.id, issuer: config.jwt.issuer, expiresIn: -10 });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('AUTH-11 rejects tokens signed with another secret, or with alg "none"', async () => {
    const user = await createUser(app);
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret-some-other-secret-1234', { subject: user.id, issuer: config.jwt.issuer });
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, iss: config.jwt.issuer })}.`;
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${none}`).expect(401);
  });

  it('AUTH-12 a valid token stops working once the account is deleted', async () => {
    const user = await createUser(app);
    await User.deleteOne({ _id: user.id });
    const res = await user.get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('AUTH-13 /auth/me reports storage usage and quota', async () => {
    const user = await createUser(app);
    await user.upload();
    const res = await user.get('/api/v1/auth/me').expect(200);
    expect(res.body.usage.usedBytes).toBeGreaterThan(0);
    expect(res.body.usage.quotaBytes).toBe(config.quotaBytes);
  });

  it('AUTH-14 role changes take effect immediately (token role is not trusted)', async () => {
    const user = await createUser(app);
    await user.get('/api/v1/admin/stats').expect(403);
    await User.updateOne({ _id: user.id }, { role: 'admin' });
    await user.get('/api/v1/admin/stats').expect(200);
  });
});
