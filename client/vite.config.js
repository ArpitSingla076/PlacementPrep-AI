import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev the browser talks to Vite (same origin), and Vite forwards /api to Express.
    // Same-origin => no CORS preflight and SameSite=Lax cookies just work.
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
});
