import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/vite-plugin.js';

// base: './' – relativa sökvägar till JS/CSS, så att bygget fungerar oavsett var det ligger.
// apiPlugin: kör API:t (/api/*) lokalt i `npm run dev` och `npm run preview`, som Vercel Functions gör i produktion.
export default defineConfig({
  base: './',
  plugins: [react(), apiPlugin()],
  server: { host: true },
});
