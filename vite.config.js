import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  build: {
    // 1. Disable Source Maps to prevent original source code inspection in DevTools
    sourcemap: false,

    // 2. Advanced Terser minification & identifier mangling
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove verbose debug logs in production; preserve errors and warnings
        pure_funcs: ['console.log', 'console.debug'],
        passes: 2
      },
      mangle: {
        toplevel: false,
        keep_classnames: false,
        keep_fnames: false
      },
      format: {
        comments: false
      }
    },
    chunkSizeWarningLimit: 2000
  }
});
