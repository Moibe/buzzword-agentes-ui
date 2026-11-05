import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// PORT y API_PORT salen del .env del checkout (default prod: UI 4175/4176, API 8077),
// para poder correr un entorno dev con otros puertos en el mismo servidor.
const env = loadEnv('', process.cwd(), '');
const PORT = Number(env.PORT) || 4175;
const API_PORT = Number(env.API_PORT) || 8077;

// El admin y sus widgets bundleados llaman al API por ruta relativa
// (/api/...) en vez de host:8077 directo — ver App.svelte/Embed.svelte/
// ContextLightEmbed.svelte. Este proxy es lo que hace que /api/* llegue de
// verdad al backend, tanto en dev como en el servidor real (que corre
// `vite preview`).
const apiProxy = {
  '/api': {
    target: `http://127.0.0.1:${API_PORT}`,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed/index.html'),
        contextlight: resolve(__dirname, 'embed/contextlight.html'),
      },
    },
  },
  server: {
    port: PORT,
    host: true,
    proxy: apiProxy,
  },
  preview: {
    port: PORT,
    host: true,
    proxy: apiProxy,
  },
});
