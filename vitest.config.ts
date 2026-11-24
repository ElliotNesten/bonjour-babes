import { defineConfig } from 'vitest/config';

// npm test: ren logik (tests/unit) och servern (tests/server) i node – ingen webbläsare.
// Servertesterna körs mot lagret i minnet, och dessutom mot Postgres om TEST_DATABASE_URL är satt
// (npm run test:pg kräver den).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/server/**/*.test.ts'],
  },
});
