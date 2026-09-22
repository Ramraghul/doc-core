const mongoose = require('mongoose');
const { connectDb, disconnectDb } = require('../../src/config/db');

/**
 * Exercises the connection-caching wrapper added for serverless (Vercel) reuse: many invocations of the
 * same warm container all call connectDb(), and must share one connection rather than racing to open
 * several (see src/config/db.js). Uses the real MongoDB the rest of the suite runs against (no mocking
 * of Mongo itself), only spying on mongoose.connect to count how many times it was actually invoked.
 */
describe('connectDb / disconnectDb (connection reuse across invocations)', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await disconnectDb();
  });

  it('SYS-30 several concurrent callers share one underlying mongoose.connect() call', async () => {
    const spy = jest.spyOn(mongoose, 'connect');
    await Promise.all([connectDb(), connectDb(), connectDb()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mongoose.connection.readyState).toBe(1);
  });

  it('SYS-31 calling connectDb again once already connected does not reconnect', async () => {
    await connectDb();
    const spy = jest.spyOn(mongoose, 'connect');
    await connectDb();
    expect(spy).not.toHaveBeenCalled();
  });

  it('SYS-32 disconnect then connect establishes a genuinely fresh connection', async () => {
    await connectDb();
    await disconnectDb();
    expect(mongoose.connection.readyState).toBe(0);
    await connectDb();
    expect(mongoose.connection.readyState).toBe(1);
  });

  it('SYS-33 a failed connection attempt does not permanently wedge future retries', async () => {
    const spy = jest.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('simulated outage'));
    await expect(connectDb()).rejects.toThrow('simulated outage');
    spy.mockRestore();
    await expect(connectDb()).resolves.toBeUndefined();
    expect(mongoose.connection.readyState).toBe(1);
  });
});
