module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/helpers/globalTeardown.js',
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  coverageThreshold: { global: { statements: 85, branches: 70, functions: 85, lines: 85 } },
};
