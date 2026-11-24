import { execSync } from 'child_process';
import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Rama de git con la que se construye: de ahí sale la etiqueta de ambiente del
// header (main → PROD, dev → DEV). En el server cada checkout está en su rama
// (deploy.sh hace checkout de PROJECT_BRANCH antes del build), así que no hay
// que configurar nada. Sin git a la mano queda vacía y no se muestra etiqueta.
function ramaGit() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

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
  define: {
    __RAMA_GIT__: JSON.stringify(ramaGit()),
  },
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
