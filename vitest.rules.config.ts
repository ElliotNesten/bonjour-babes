import { defineConfig } from 'vitest/config';

// Tester av database.rules.json (npm run test:rules). Körs inuti
// `firebase emulators:exec`, som startar databas- och auth-emulatorerna.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // Alla tester delar samma emulator-databas – kör dem i tur och ordning.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
