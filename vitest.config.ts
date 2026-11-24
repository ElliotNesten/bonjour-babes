import { defineConfig } from 'vitest/config';

// Enhetstester (npm test): ren logik i node, ingen webbläsare och ingen databas.
// Reglertesterna mot Firebase-emulatorn har en egen konfiguration (vitest.rules.config.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
