import { resolve } from 'path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
  },
  preview: {
    port: 4175,
    host: true,
  },
});
