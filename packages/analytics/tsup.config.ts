import { defineConfig } from 'tsup';

// Consumed as a git dependency from an orphan branch, so the output has to be
// self-contained. Declarations are emitted by tsc instead of tsup's dts worker,
// which resolves the repository root tsconfig rather than this one.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: true,
});
