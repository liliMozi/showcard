import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'reference/test/**/*.test.js',
      'conformance/test/**/*.test.js',
      'packages/showcard/test/**/*.test.js',
    ],
  },
});
