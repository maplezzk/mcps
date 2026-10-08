import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['src/tests/global-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: [
      'dist/**',
      'node_modules/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        statements: 70,
        branches: 60,
        functions: 75,
        'src/core/config.ts': { lines: 90, branches: 90 },
        'src/core/client.ts': { lines: 90, branches: 75 },
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/tests/**',
        'src/types/**',
        'dist/**',
        'node_modules/**'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
