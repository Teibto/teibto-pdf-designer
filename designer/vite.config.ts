import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isNetsuite = mode === 'netsuite';

  return {
    plugins: [tailwindcss()],
    base: './',  // Relative paths — required for NetSuite File Cabinet
    worker: {
      format: 'es',
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      target: 'es2022',
      outDir: isNetsuite ? 'dist-netsuite' : 'dist',
      rollupOptions: {
        output: {
          // For NetSuite: single JS file to simplify File Cabinet upload
          ...(isNetsuite ? {
            inlineDynamicImports: true,
            entryFileNames: 'assets/pld-app.js',
            assetFileNames: 'assets/pld-app[extname]',
          } : {
            manualChunks: {
              'barcode': ['bwip-js'],
            },
          }),
        },
      },
    },
  };
});
