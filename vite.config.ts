import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' gör att sidan fungerar under valfri sökväg, t.ex. GitHub Pages (/bonjour-babes/).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
});
