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
 * The branch holds only build output and shares no history with master on purpose —
 * nothing here should ever appear in a diff against upstream.
 *
 * Each publish appends a commit rather than replacing the branch. A consumer's
 * yarn.lock pins the exact commit it installed, so force-pushing would orphan it and
 * `yarn install --frozen-lockfile` would eventually fail once the commit is collected.
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
  // Vercel watches every branch in this repository, so a push here starts a build of a
  // branch that holds no Next.js app and it fails with "No Next.js version detected".
  // Two independent guards, because the noise is a failed deployment notification each
  // time the package is published: vercel.json turns deployments off for this branch,
  // and the commit message carries the skip marker Vercel honours on its own.
  fs.writeFileSync(
    path.join(stage, 'vercel.json'),
    `${JSON.stringify({ git: { deploymentEnabled: { [BRANCH]: false } } }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(stage, 'README.md'),
    `# ${pkg.name}\n\nBuild output only. Source and tests live in \`packages/analytics\` on \`master\`.\nBuilt from ${sourceCommit}.\n`,
  );

  run('git', ['init', '-q', '-b', BRANCH], stage);
  run('git', ['remote', 'add', 'origin', originUrl], stage);

  // Continue the existing branch when there is one, so previously pinned commits stay
  // reachable. Only the very first publish starts from nothing.
  let hasHistory = false;
  try {
    run('git', ['fetch', '-q', '--depth', '50', 'origin', BRANCH], stage);
    run('git', ['reset', '-q', '--soft', 'FETCH_HEAD'], stage);
    hasHistory = true;
  } catch {
    console.log(`No ${BRANCH} branch yet, starting one.`);
  }

  run('git', ['add', '-A'], stage);
  run(
    'git',
    ['-c', 'user.name=vzb-analytics', '-c', 'user.email=noreply@vzdelanibudoucnosti.cz',
     'commit', '-q', '-m', `build: ${pkg.name}@${pkg.version} from ${sourceCommit} [skip ci]`],
    stage,
  );

  if (dryRun) {
    console.log(`Dry run. Staged ${fs.readdirSync(stage).length} entries in ${stage}`);
    console.log(run('git', ['show', '--stat', '--oneline', 'HEAD'], stage));
    process.exit(0);
  }

  run('git', ['push', '-q', 'origin', `HEAD:${BRANCH}`], stage);

  const head = run('git', ['rev-parse', '--short', 'HEAD'], stage);

  console.log(
    `Published ${pkg.name}@${pkg.version} to ${BRANCH} as ${head} ` +
      `(built from ${sourceCommit}, ${hasHistory ? 'appended' : 'new branch'}).`,
  );
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
