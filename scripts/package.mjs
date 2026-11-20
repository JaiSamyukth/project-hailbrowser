// Build dist/HailBrowser-<version>.zip: the repository files, the coding-agent bridge's
// production packages, and an install record so the launcher's first update check knows which
// commit it has. Needs git, npm and the `zip` command.
//   node scripts/package.mjs [--branch main]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const branchArg = process.argv.indexOf('--branch');
const branch = branchArg > 0 ? process.argv[branchArg + 1] : 'main';
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const version = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
const commit = run('git', ['rev-parse', 'HEAD']);
if (run('git', ['status', '--porcelain', '--untracked-files=no'])) {
  console.error('Commit your changes first: the zip records the current commit.');
  process.exit(1);
}
const files = run('git', ['ls-files']).split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hailbrowser-pkg-'));
const top = path.join(stage, 'HailBrowser');
for (const f of files) {
  const dest = path.join(top, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, f), dest);
  fs.chmodSync(dest, fs.statSync(path.join(root, f)).mode);
}

console.log('Installing production packages…');
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: top, stdio: 'inherit', env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' } });
// The workspace link is a symlink, which Windows can't unpack; nothing needs it at run time.
fs.rmSync(path.join(top, 'node_modules', 'hailbrowser-mcp'), { force: true, recursive: true });
fs.rmSync(path.join(top, 'node_modules', '.package-lock.json'), { force: true });

fs.mkdirSync(path.join(top, '.hailbrowser'), { recursive: true });
fs.writeFileSync(path.join(top, '.hailbrowser', 'installed.json'), JSON.stringify({ commit, branch, repo: 'JaiSamyukth/project-hailbrowser', at: new Date().toISOString(), via: 'zip', files }, null, 2));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `HailBrowser-${version}.zip`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-rqX', out, 'HailBrowser'], { cwd: stage, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Built ${path.relative(root, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) from ${commit.slice(0, 7)}`);
