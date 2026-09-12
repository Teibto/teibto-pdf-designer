import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ mode }) => {
  const isNetsuite = mode === 'netsuite';
  const provenance = resolve(__dirname, '../scripts/build-provenance.mjs');
  let sourceSnapshot = '';

  return {
    plugins: [tailwindcss(), ...(isNetsuite ? [{
      name: 'netsuite-build-provenance',
      buildStart() {
        sourceSnapshot = execFileSync(process.execPath, [provenance, 'snapshot'], { encoding: 'utf8' });
      },
      writeBundle() {
        execFileSync(process.execPath, [provenance, 'seal'], { input: sourceSnapshot, stdio: ['pipe', 'inherit', 'inherit'] });
      },
    }] : [])],
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
