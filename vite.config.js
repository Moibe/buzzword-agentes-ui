import { resolve } from 'path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// El admin y sus widgets bundleados llaman al API por ruta relativa
// (/api/...) en vez de host:8077 directo — ver App.svelte/Embed.svelte/
// ContextLightEmbed.svelte. Este proxy es lo que hace que /api/* llegue de
// verdad al backend, tanto en dev como en el servidor real (que corre
// `vite preview`).
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8077',
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
    port: 4175,
    host: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4175,
    host: true,
    proxy: apiProxy,
  },
});
