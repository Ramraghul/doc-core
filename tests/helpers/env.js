// Runs in every Jest worker BEFORE any application module is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing; production uses 12
process.env.MONGODB_URI = `${process.env.TEST_MONGO_URI}docucore_test_${process.env.JEST_WORKER_ID || 0}`;
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;
delete process.env.DEMO_EMAIL;
delete process.env.DEMO_PASSWORD;
