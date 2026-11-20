// Launcher internals: settings file, browser detection, extension detection and self-update.
// Plain Node (18+), no dependencies, so it runs straight from the downloaded zip.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_ID = 'gpgloopdhooiinahamlfpffbdfobhgel'; // fixed by "key" in manifest.json
export const CONFIG_NAME = 'hailbrowser.config.json';
export const STATE_DIR = '.hailbrowser';

// Paths an update never touches: your settings, launcher state, installed packages, git data.
const KEEP = new Set([CONFIG_NAME, STATE_DIR, 'node_modules', '.git', 'extension/update-stamp.json']);

export const DEFAULT_CONFIG = {
  '//': 'HailBrowser launcher settings. Edit and save, then run the start script again. See docs/launcher.md.',
  browser: 'chrome',
  browserPath: '',
  profile: 'Default',
  userDataDir: '',
  newWindow: true,
  startUrls: ['https://www.google.com'],
  showMenu: true,
  extraBrowserArgs: [],
  updates: {
    check: 'on-launch',
    repo: 'JaiSamyukth/project-hailbrowser',
    branch: 'main',
  },
};

// ---------- settings file ----------

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

/** Check types and values; returns a list of readable problems (empty when fine). */
export function validateConfig(c) {
  const errs = [];
  if (!['chrome', 'edge', 'brave', 'chromium'].includes(c.browser)) errs.push('"browser" must be chrome, edge, brave or chromium.');
  if (typeof c.browserPath !== 'string') errs.push('"browserPath" must be text ("" to find it automatically).');
  if (typeof c.profile !== 'string' || !c.profile.trim()) errs.push('"profile" must be a profile folder name such as "Default" or "Profile 1".');
  if (typeof c.userDataDir !== 'string') errs.push('"userDataDir" must be text ("" for the browser\'s normal folder).');
  if (typeof c.newWindow !== 'boolean') errs.push('"newWindow" must be true or false.');
  if (typeof c.showMenu !== 'boolean') errs.push('"showMenu" must be true or false.');
  if (!Array.isArray(c.startUrls) || c.startUrls.some((u) => typeof u !== 'string')) errs.push('"startUrls" must be a list of web addresses.');
  if (!Array.isArray(c.extraBrowserArgs) || c.extraBrowserArgs.some((u) => typeof u !== 'string')) errs.push('"extraBrowserArgs" must be a list of text.');
  if (!['on-launch', 'ask', 'off'].includes(c.updates?.check)) errs.push('"updates.check" must be on-launch, ask or off.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.updates?.repo || '')) errs.push('"updates.repo" must look like owner/name.');
  if (!/^[\w./-]+$/.test(c.updates?.branch || '')) errs.push('"updates.branch" must be a branch name.');
  return errs;
}

/** Load settings, creating the file with defaults on first run. Throws with a readable message. */
export function loadConfig(root = ROOT) {
  const file = path.join(root, CONFIG_NAME);
  if (!fs.existsSync(file)) {
    saveConfig(DEFAULT_CONFIG, root);
    return { ...structuredClone(DEFAULT_CONFIG), _created: true };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${CONFIG_NAME} is not valid JSON (${e.message}). Fix it, or delete it to start over with the defaults.`);
  }
  const config = merge(DEFAULT_CONFIG, raw);
  const errs = validateConfig(config);
  if (errs.length) throw new Error(`${CONFIG_NAME} has problems:\n  - ${errs.join('\n  - ')}`);
  return config;
}

export function saveConfig(config, root = ROOT) {
  const { _created, ...clean } = config;
  const file = path.join(root, CONFIG_NAME);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(clean, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/** Accept "example.com" as well as full addresses; reject anything that is not web or file. */
export function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^(https?|file|chrome|edge|brave):/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/i.test(s)) return `https://${s}`;
  return null;
}

// ---------- browsers ----------

const WIN_BROWSERS = {
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  edge: 'Microsoft\\Edge\\Application\\msedge.exe',
  brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  chromium: 'Chromium\\Application\\chrome.exe',
};
const MAC_BROWSERS = {
  chrome: 'Google Chrome.app/Contents/MacOS/Google Chrome',
  edge: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  brave: 'Brave Browser.app/Contents/MacOS/Brave Browser',
  chromium: 'Chromium.app/Contents/MacOS/Chromium',
};
const LINUX_BROWSERS = {
  chrome: ['google-chrome-stable', 'google-chrome'],
  edge: ['microsoft-edge-stable', 'microsoft-edge'],
  brave: ['brave-browser', 'brave'],
  chromium: ['chromium', 'chromium-browser'],
};

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

/** Path of the browser to start, or null if it isn't installed where browsers usually are. */
export function findBrowser(config, platform = process.platform, env = process.env) {
  if (config.browserPath) return fs.existsSync(config.browserPath) ? config.browserPath : null;
  const name = config.browser;
  if (platform === 'win32') {
    const bases = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.ProgramW6432].filter(Boolean);
    for (const b of bases) {
      const p = path.win32.join(b, WIN_BROWSERS[name]);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  if (platform === 'darwin') {
    for (const b of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const p = path.join(b, MAC_BROWSERS[name]);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  for (const cmd of LINUX_BROWSERS[name]) {
    const p = which(cmd);
    if (p) return p;
  }
  return null;
}

/** The browser's own data folder (where profiles and logins live). */
export function userDataDir(config, platform = process.platform, env = process.env, home = os.homedir()) {
  if (config.userDataDir) return config.userDataDir;
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = {
    win32: { chrome: 'Google/Chrome/User Data', edge: 'Microsoft/Edge/User Data', brave: 'BraveSoftware/Brave-Browser/User Data', chromium: 'Chromium/User Data' },
    darwin: { chrome: 'Google/Chrome', edge: 'Microsoft Edge', brave: 'BraveSoftware/Brave-Browser', chromium: 'Chromium' },
    linux: { chrome: 'google-chrome', edge: 'microsoft-edge', brave: 'BraveSoftware/Brave-Browser', chromium: 'chromium' },
  };
  const rel = (dirs[platform] || dirs.linux)[config.browser];
  if (platform === 'win32') return path.join(local, ...rel.split('/'));
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', ...rel.split('/'));
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), ...rel.split('/'));
}

/** Profiles listed in the browser's "Local State": [{dir, name}]. */
export function listProfiles(dataDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf8'));
    const cache = state.profile?.info_cache || {};
    return Object.entries(cache).map(([dir, info]) => ({ dir, name: info.name || info.gaia_name || dir }));
  } catch {
    return [];
  }
}

const samePath = (a, b) => {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * Is HailBrowser loaded in this profile? Reads the profile's (Secure) Preferences, which list
 * unpacked extensions with their folder. Returns {id, path, enabled} or null.
 */
export function findInstalledExtension(profileDir, extensionDir = path.join(ROOT, 'extension')) {
  for (const name of ['Secure Preferences', 'Preferences']) {
    let prefs;
    try { prefs = JSON.parse(fs.readFileSync(path.join(profileDir, name), 'utf8')); } catch { continue; }
    const settings = prefs.extensions?.settings || {};
    for (const [id, s] of Object.entries(settings)) {
      if (id === EXTENSION_ID || (s?.path && samePath(s.path, extensionDir))) {
        const reasons = s.disable_reasons;
        const disabled = (Array.isArray(reasons) ? reasons.length > 0 : Number(reasons) > 0) || s.state === 0;
        return { id, path: s.path || '', enabled: !disabled };
      }
    }
  }
  return null;
}

export function extensionsPage(config) {
  return config.browser === 'edge' ? 'edge://extensions' : 'chrome://extensions';
}

/** Start the browser with the configured profile and pages; it stays open after we exit. */
export function launchBrowser(browserPath, config, urls) {
  const args = [`--profile-directory=${config.profile}`];
  if (config.userDataDir) args.push(`--user-data-dir=${config.userDataDir}`);
  if (config.newWindow) args.push('--new-window');
  args.push(...config.extraBrowserArgs, ...urls);
  const child = spawn(browserPath, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return args;
}

/** Open a file or folder with the system's default app. */
export function openWithSystem(target) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]]
      : ['xdg-open', [target]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** Remember which extension the MCP bridge should trust (it is the one in this folder). */
export function trustExtension(id, file = path.join(os.homedir(), STATE_DIR, 'trusted-extension.json')) {
  let current = null;
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')).extensionId; } catch {}
  if (current === id) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ extensionId: id, trustedAt: new Date().toISOString() }, null, 2));
  return true;
}

// ---------- updates ----------

export function readInstalled(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, STATE_DIR, 'installed.json'), 'utf8')); } catch { return null; }
}

function writeInstalled(root, info) {
  fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, STATE_DIR, 'installed.json'), JSON.stringify(info, null, 2));
}

/** Tell a running extension that new files are on disk (it reloads itself when idle). */
export function writeStamp(root, commit) {
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).version; } catch {}
  const stamp = { id: `${commit}-${Date.now()}`, version, commit, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'extension', 'update-stamp.json'), JSON.stringify(stamp, null, 2));
  return stamp;
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function hasGit(root = ROOT) {
  if (!fs.existsSync(path.join(root, '.git'))) return false;
  return spawnSync('git', ['--version']).status === 0;
}

/** Every file under dir (relative, forward slashes), skipping the KEEP paths. */
export function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (KEEP.has(rel) || entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) listFiles(abs, base, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Copy a downloaded copy (srcDir) over the install (root). Files that changed are backed up first
 * and put back if anything fails. Files the previous update installed but the new version no
 * longer has are removed; files you added yourself are never touched.
 */
export function applyTree(srcDir, root, previousFiles = []) {
  const files = listFiles(srcDir);
  if (!files.includes('extension/manifest.json')) throw new Error('The download does not look like HailBrowser (no extension/manifest.json).');
  if (!files.includes('launcher/hailbrowser.mjs')) throw new Error('That branch on GitHub has no start script yet, so it was not installed. Pick another branch in Settings → Updates.');
  const backup = path.join(root, STATE_DIR, 'backup');
  fs.rmSync(backup, { recursive: true, force: true });
  const touched = []; // [rel, existedBefore]
  const changed = [];
  const fresh = new Set(files);
  const removed = previousFiles.filter((f) => !fresh.has(f) && !KEEP.has(f) && fs.existsSync(path.join(root, f)));
  try {
    for (const rel of [...files, ...removed]) {
      const dest = path.join(root, rel);
      const src = fresh.has(rel) ? path.join(srcDir, rel) : null;
      const existed = fs.existsSync(dest);
      if (src && existed && fs.readFileSync(src).equals(fs.readFileSync(dest))) continue;
      if (existed) {
        fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
        fs.copyFileSync(dest, path.join(backup, rel));
      }
      touched.push([rel, existed]);
      if (src) {
        // Write next to the file, then rename: a running start script keeps reading its old copy.
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, `${dest}.hbnew`);
        fs.chmodSync(`${dest}.hbnew`, fs.statSync(src).mode | 0o600);
        fs.renameSync(`${dest}.hbnew`, dest);
      } else fs.rmSync(dest, { force: true });
      changed.push(rel);
    }
  } catch (e) {
    for (const [rel, existed] of touched.reverse()) {
      const dest = path.join(root, rel);
      try {
        fs.rmSync(`${dest}.hbnew`, { force: true });
        if (existed) fs.copyFileSync(path.join(backup, rel), dest);
        else fs.rmSync(dest, { force: true });
      } catch {}
    }
    throw new Error(`Update failed and was undone: ${e.message}`);
  }
  return { files, changed };
}

async function latestCommit(repo, branch) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
    headers: { accept: 'application/vnd.github.sha', 'user-agent': 'hailbrowser-launcher' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404 || res.status === 422) throw new Error(`GitHub has no branch "${branch}" in ${repo}.`);
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached; try again in an hour.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Unexpected answer from GitHub.');
  return sha;
}

function extractZip(zip, dest) {
  const tries = process.platform === 'win32'
    ? [['tar', ['-xf', zip, '-C', dest]], ['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]]]
    : [['unzip', ['-q', '-o', zip, '-d', dest]], ['tar', ['-xf', zip, '-C', dest]], ['python3', ['-m', 'zipfile', '-e', zip, dest]]];
  for (const [cmd, args] of tries) {
    if (spawnSync(cmd, args, { stdio: 'ignore' }).status === 0) return;
  }
  throw new Error('Could not unpack the download (no tar, unzip or python3 found).');
}

function npmInstall(root, log) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  log('Installing packages for the coding-agent bridge…');
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) log('npm install did not finish. The extension works anyway; run "npm install" later for coding agents.');
}

/**
 * Bring this install up to date with GitHub. Uses git when this folder is a git checkout,
 * otherwise downloads the branch as a zip. Returns {updated, message, changed?}.
 */
export async function update(config, { root = ROOT, log = console.log } = {}) {
  const { repo, branch } = config.updates;
  if (hasGit(root)) {
    try {
      const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
      if (dirty) return { updated: false, message: 'You have edited files in this git checkout, so it was not updated. Commit or stash them, then update.' };
      const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (current !== branch) return { updated: false, message: `This checkout is on branch "${current}", not "${branch}". Switch branches or change updates.branch.` };
      git(root, ['fetch', '--quiet', 'origin', branch]);
      const head = git(root, ['rev-parse', 'HEAD']);
      const remote = git(root, ['rev-parse', 'FETCH_HEAD']);
      if (head === remote) return { updated: false, message: 'Already up to date.' };
      const before = git(root, ['rev-parse', 'HEAD:package-lock.json']);
      git(root, ['merge', '--ff-only', '--quiet', 'FETCH_HEAD']);
      const changed = git(root, ['diff', '--name-only', head, 'HEAD']).split('\n').filter(Boolean);
      if (git(root, ['rev-parse', 'HEAD:package-lock.json']) !== before || !fs.existsSync(path.join(root, 'node_modules'))) npmInstall(root, log);
      writeStamp(root, remote);
      writeInstalled(root, { commit: remote, branch, repo, at: new Date().toISOString(), via: 'git' });
      return { updated: true, message: `Updated to ${remote.slice(0, 7)} (${changed.length} files changed).`, changed };
    } catch (e) {
      return { updated: false, message: `git update failed: ${String(e.stderr || e.message).trim().split('\n')[0]}` };
    }
  }

  const installed = readInstalled(root);
  const sha = await latestCommit(repo, branch);
  if (installed?.commit === sha) return { updated: false, message: 'Already up to date.' };
  log(`Downloading ${repo}@${branch} (${sha.slice(0, 7)})…`);
  const res = await fetch(`https://codeload.github.com/${repo}/zip/${sha}`, { headers: { 'user-agent': 'hailbrowser-launcher' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hailbrowser-update-'));
  try {
    const zip = path.join(tmp, 'update.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const out = path.join(tmp, 'x');
    fs.mkdirSync(out);
    extractZip(zip, out);
    const top = fs.readdirSync(out).filter((n) => fs.statSync(path.join(out, n)).isDirectory());
    if (top.length !== 1) throw new Error('Unexpected download layout.');
    const src = path.join(out, top[0]);
    const lockBefore = fs.existsSync(path.join(root, 'package-lock.json')) ? fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8') : '';
    const { files, changed } = applyTree(src, root, installed?.files || []);
    const lockAfter = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    if (lockAfter !== lockBefore || !fs.existsSync(path.join(root, 'node_modules'))) npmInstall(root, log);
    writeStamp(root, sha);
    writeInstalled(root, { commit: sha, branch, repo, at: new Date().toISOString(), via: 'zip', files });
    return { updated: true, message: `Updated to ${sha.slice(0, 7)} (${changed.length} files changed).`, changed };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
