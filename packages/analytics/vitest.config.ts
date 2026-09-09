import { defineConfig } from 'vitest/config';

// Own config so the root one stays exactly as upstream ships it — the root include
// pattern is src/**, which would never pick this package up anyway.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
