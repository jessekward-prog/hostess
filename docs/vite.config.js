import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-v4.js',
        chunkFileNames: 'assets/[name]-v4.js',
        assetFileNames: 'assets/app-v4.[ext]'
      }
    }
  }
});
