import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // Workspace packages are TypeScript sources: bundle them in.
  noExternal: ['@poker/shared', '@poker/game-engine'],
});
