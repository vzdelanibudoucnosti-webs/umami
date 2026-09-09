/* eslint-disable no-console */
/**
 * Publish the built package to the `analytics-dist` orphan branch.
 *
 * npm and yarn cannot install a subdirectory of a git repository, so the package cannot
 * be consumed from packages/analytics directly. The orphan branch carries the built
 * output with package.json at its root, which is a shape they can install:
 *
 *   yarn add "git+https://github.com/<owner>/umami.git#analytics-dist"
 *
 * The branch holds only build output. It is force-pushed on every publish and has no
 * shared history with master on purpose — nothing here should ever appear in a diff
 * against upstream.
 *
 * Usage: node scripts/publish-dist.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRANCH = 'analytics-dist';
const packageDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(packageDir, 'dist');
const dryRun = process.argv.includes('--dry-run');

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

if (!fs.existsSync(distDir)) {
  console.error('dist/ is missing — run `pnpm build` in packages/analytics first.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const originUrl = run('git', ['remote', 'get-url', 'origin'], packageDir);
const sourceCommit = run('git', ['rev-parse', '--short', 'HEAD'], packageDir);

// The dist contents land at the branch root, so the paths lose their dist/ prefix.
const publishedPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: 'module',
  main: './index.cjs',
  module: './index.js',
  types: './index.d.ts',
  sideEffects: false,
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js',
      require: './index.cjs',
    },
  },
};

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vzb-analytics-'));

try {
  fs.cpSync(distDir, stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(publishedPkg, null, 2)}\n`);
  fs.writeFileSync(
    path.join(stage, 'README.md'),
    `# ${pkg.name}\n\nBuild output only. Source and tests live in \`packages/analytics\` on \`master\`.\nBuilt from ${sourceCommit}.\n`,
  );

  run('git', ['init', '-q', '-b', BRANCH], stage);
  run('git', ['add', '-A'], stage);
  run(
    'git',
    ['-c', 'user.name=vzb-analytics', '-c', 'user.email=noreply@vzdelanibudoucnosti.cz',
     'commit', '-q', '-m', `build: ${pkg.name}@${pkg.version} from ${sourceCommit}`],
    stage,
  );

  if (dryRun) {
    console.log(`Dry run. Staged ${fs.readdirSync(stage).length} entries in ${stage}`);
    console.log(run('git', ['show', '--stat', '--oneline', 'HEAD'], stage));
    process.exit(0);
  }

  run('git', ['remote', 'add', 'origin', originUrl], stage);
  run('git', ['push', '-q', '--force', 'origin', `${BRANCH}:${BRANCH}`], stage);

  console.log(`Published ${pkg.name}@${pkg.version} to ${BRANCH} (built from ${sourceCommit}).`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
