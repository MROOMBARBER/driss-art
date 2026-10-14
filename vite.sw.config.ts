import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve('src/firebase-messaging-sw.ts'),
      name: 'XauusdPush',
      formats: ['iife'],
      fileName: () => 'firebase-messaging-sw.js',
    },
  },
});
