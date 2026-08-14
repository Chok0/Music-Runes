import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  server: { port: 5173 },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
