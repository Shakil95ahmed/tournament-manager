import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base: the same build works at a GitHub Pages project URL,
  // a user page, a custom domain, or opened from a sub-folder.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
