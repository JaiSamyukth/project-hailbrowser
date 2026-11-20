#!/usr/bin/env node
// HailBrowser launcher: updates from GitHub, then opens your browser with the extension's
// start pages. Run it through start.bat (Windows) or start.sh (macOS / Linux).
//
//   start [--menu]       show the menu (default when "showMenu" is true)
//   start --start        open the browser right away
//   start --update       only check for updates
//   start --settings     change settings
//   start --doctor       check the setup
//   start --no-update    skip the update check this time
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  CONFIG_NAME, ROOT, extensionsPage, findBrowser, findInstalledExtension, launchBrowser, listProfiles,
  loadConfig, normalizeUrl, openWithSystem, readInstalled, saveConfig, trustExtension, update, userDataDir,
} from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const EXT_DIR = path.join(ROOT, 'extension');
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const ok = (s) => console.log(`${c('32', '✓')} ${s}`);
const warn = (s) => console.log(`${c('33', '!')} ${s}`);
const info = (s) => console.log(`  ${s}`);

let rl = null;
const ask = async (q) => {
  if (!process.stdin.isTTY) return '';
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(q)).trim();
};
const yes = async (q, def = true) => {
  const a = (await ask(`${q} ${def ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
  return a ? a.startsWith('y') : def;
};

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version; } catch { return '?'; }
}

// ---------- update ----------

async function runUpdate(config, { quiet = false } = {}) {
  try {
    const r = await update(config, { log: info });
    if (r.updated) ok(r.message);
    else if (!quiet || !/up to date/i.test(r.message)) (/up to date/i.test(r.message) ? ok : warn)(r.message);
    return r;
  } catch (e) {
    warn(`Could not check for updates: ${e.message}`);
    return { updated: false };
  }
}

/** After an update the launcher itself may be new: run the new copy once. */
function restartSelf() {
  rl?.close();
  const args = [...argv.filter((a) => a !== '--update'), '--no-update'];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'launcher', 'hailbrowser.mjs'), ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

// ---------- browser ----------

function profileDir(config) {
  return path.join(userDataDir(config), config.profile);
}

function welcomeUrl(config, installed) {
  const url = pathToFileURL(path.join(ROOT, 'launcher', 'welcome.html'));
  url.hash = new URLSearchParams({ path: EXT_DIR, installed: installed ? '1' : '0', page: extensionsPage(config) }).toString();
  return url.href;
}

async function start(config) {
  const browser = findBrowser(config);
  if (!browser) {
    warn(config.browserPath
      ? `No browser at "${config.browserPath}". Fix "browserPath" in ${CONFIG_NAME}.`
      : `Could not find ${config.browser}. Install it, or set "browserPath" in ${CONFIG_NAME} to the browser's program file.`);
    return false;
  }
  const ext = findInstalledExtension(profileDir(config));
  const urls = [];
  if (!ext) {
    warn('HailBrowser is not added to this browser profile yet. Opening the setup guide.');
    info(`1. Type ${bold(extensionsPage(config))} in the browser's address bar.`);
    info(`2. Turn on ${bold('Developer mode')} (top right of that page).`);
    info(`3. Click ${bold('Load unpacked')} and pick this folder:`);
    info(`   ${bold(EXT_DIR)}`);
    info('4. Pin HailBrowser, then click its icon or press Alt+H to open the side panel.');
    urls.push(welcomeUrl(config, false));
    openWithSystem(EXT_DIR);
  } else {
    if (!ext.enabled) {
      warn(`HailBrowser is turned off. Type ${extensionsPage(config)} in the address bar and turn it back on.`);
    }
    if (trustExtension(ext.id)) ok('Coding agents will trust this copy of HailBrowser.');
    if (ext.path && path.resolve(ext.path) !== path.resolve(EXT_DIR)) {
      warn(`The browser loads HailBrowser from another folder: ${ext.path}`);
      info(`Updates here will not reach it. Remove it at ${extensionsPage(config)} and load this folder instead:`);
      info(EXT_DIR);
      urls.push(welcomeUrl(config, false));
    }
  }
  urls.push(...config.startUrls.map(normalizeUrl).filter(Boolean));
  launchBrowser(browser, config, urls);
  ok(`Opened ${path.basename(browser)} (profile "${config.profile}")${urls.length ? ` with ${urls.length} tab${urls.length > 1 ? 's' : ''}` : ''}.`);
  if (ext?.enabled) info(dim('Open the side panel with the HailBrowser toolbar icon or Alt+H.'));
  return true;
}

// ---------- settings ----------

async function editSettings(config) {
  for (;;) {
    const profiles = listProfiles(userDataDir(config));
    const profName = profiles.find((p) => p.dir === config.profile)?.name;
    console.log(`\n${bold('Settings')} ${dim(`(${path.join(ROOT, CONFIG_NAME)})`)}`);
    console.log(`  1. Browser           ${config.browser}${config.browserPath ? ` at ${config.browserPath}` : ''}`);
    console.log(`  2. Profile           ${config.profile}${profName && profName !== config.profile ? ` (${profName})` : ''}`);
    console.log(`  3. Start pages       ${config.startUrls.length ? config.startUrls.join(', ') : 'none'}`);
    console.log(`  4. Open a new window ${config.newWindow ? 'yes' : 'no'}`);
    console.log(`  5. Updates           ${config.updates.check} from ${config.updates.repo}@${config.updates.branch}`);
    console.log(`  6. Show this menu    ${config.showMenu ? 'yes' : 'no (start goes straight to the browser)'}`);
    console.log('  7. Open the settings file in a text editor');
    console.log('  0. Back');
    const a = await ask('Choose: ');
    if (a === '1') {
      const b = (await ask('Browser (chrome, edge, brave, chromium): ')).toLowerCase();
      if (['chrome', 'edge', 'brave', 'chromium'].includes(b)) config.browser = b;
      const p = await ask('Program file (Enter to find it automatically): ');
      config.browserPath = p.replace(/^"|"$/g, '');
      if (!findBrowser(config)) warn('That browser was not found; check the program file.');
    } else if (a === '2') {
      if (profiles.length) profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} ${dim(`(${p.dir})`)}`));
      else info('No profiles found; type the folder name (usually "Default").');
      const p = await ask('Profile number or folder name: ');
      const pick = profiles[Number(p) - 1]?.dir || p;
      if (pick) config.profile = pick;
    } else if (a === '3') {
      const v = await ask('Start pages, separated by spaces or commas (Enter for none): ');
      const list = v.split(/[\s,]+/).filter(Boolean);
      const urls = list.map(normalizeUrl);
      const bad = list.filter((_, i) => !urls[i]);
      if (bad.length) warn(`Skipped: ${bad.join(', ')}`);
      config.startUrls = urls.filter(Boolean);
    } else if (a === '4') config.newWindow = !config.newWindow;
    else if (a === '5') {
      const m = (await ask('Check for updates: 1 every launch, 2 ask first, 3 never: '));
      config.updates.check = { 1: 'on-launch', 2: 'ask', 3: 'off' }[m] || config.updates.check;
      const br = await ask(`Branch (Enter keeps "${config.updates.branch}"): `);
      if (/^[\w./-]+$/.test(br)) config.updates.branch = br;
    } else if (a === '6') config.showMenu = !config.showMenu;
    else if (a === '7') {
      saveConfig(config);
      openWithSystem(path.join(ROOT, CONFIG_NAME));
      info('Save the file, then come back here.');
      await ask('Press Enter when done… ');
      try { Object.assign(config, loadConfig()); } catch (e) { warn(e.message); }
      continue;
    } else return config;
    saveConfig(config);
    ok('Saved.');
  }
}

// ---------- health check ----------

async function doctor(config) {
  console.log(`\n${bold('Health check')}`);
  const [maj] = process.versions.node.split('.').map(Number);
  (maj >= 18 ? ok : warn)(`Node.js ${process.versions.node}${maj >= 18 ? '' : ' (18 or newer is needed)'}`);
  const browser = findBrowser(config);
  browser ? ok(`Browser: ${browser}`) : warn(`Browser "${config.browser}" not found.`);
  const dir = profileDir(config);
  fs.existsSync(dir) ? ok(`Profile folder: ${dir}`) : warn(`Profile folder not found: ${dir} (it is created the first time the browser uses it).`);
  const ext = findInstalledExtension(dir);
  if (!ext) warn('Extension: not added to this profile yet (choose "Start" to get the setup guide).');
  else ok(`Extension: ${ext.enabled ? 'on' : 'off'}, id ${ext.id}${ext.path ? `, from ${ext.path}` : ''}`);
  const mods = ['@modelcontextprotocol/sdk', 'ws'].every((m) => fs.existsSync(path.join(ROOT, 'node_modules', m)));
  mods ? ok('Coding-agent bridge packages are installed.') : warn('Coding-agent bridge packages are missing: run "npm install --omit=dev" here (only needed for coding agents).');
  const inst = readInstalled();
  info(`Version ${version()}${inst?.commit ? `, commit ${inst.commit.slice(0, 7)} from ${inst.branch}` : ''}; updates: ${config.updates.check}.`);
}

function mcpSetup() {
  console.log(`\n${bold('Connect a coding agent')}`);
  spawnSync(process.execPath, [path.join(ROOT, 'mcp-server', 'src', 'index.js'), 'setup'], { stdio: 'inherit' });
}

function installGuide(config) {
  const browser = findBrowser(config);
  if (!browser) return warn(`Could not find ${config.browser}.`);
  const installed = !!findInstalledExtension(profileDir(config));
  launchBrowser(browser, config, [welcomeUrl(config, installed)]);
  openWithSystem(EXT_DIR);
  ok(`Opened the setup guide. At ${extensionsPage(config)}, load this folder with "Load unpacked":`);
  info(EXT_DIR);
}

// ---------- main ----------

async function menu(config) {
  for (;;) {
    console.log(`\n${bold('⚡ HailBrowser')} ${dim(`v${version()}`)}`);
    console.log('  1. Start HailBrowser (opens your browser)   [Enter]');
    console.log('  2. Check for updates');
    console.log('  3. Settings');
    console.log('  4. Add the extension to the browser (setup guide)');
    console.log('  5. Connect a coding agent (Claude Code, Cursor…)');
    console.log('  6. Health check');
    console.log('  0. Exit');
    const a = await ask('Choose: ');
    if (a === '' || a === '1') { await start(config); return; }
    if (a === '2') { const r = await runUpdate(config); if (r.updated) restartSelf(); }
    else if (a === '3') await editSettings(config);
    else if (a === '4') installGuide(config);
    else if (a === '5') mcpSetup();
    else if (a === '6') await doctor(config);
    else if (a === '0' || a.toLowerCase() === 'q') return;
  }
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    warn(e.message);
    process.exitCode = 1;
    return;
  }
  if (config._created) ok(`Created ${CONFIG_NAME} with the default settings.`);

  if (flag('--update')) { await runUpdate(config); return; }
  if (!flag('--no-update') && config.updates.check !== 'off') {
    const go = config.updates.check === 'on-launch' || await yes('Check GitHub for a HailBrowser update?');
    if (go) {
      const r = await runUpdate(config, { quiet: true });
      if (r.updated) return restartSelf();
    }
  }
  if (flag('--settings')) await editSettings(config);
  else if (flag('--doctor')) await doctor(config);
  else if (flag('--start') || !config.showMenu || !process.stdin.isTTY) await start(config);
  else await menu(config);
}

main().catch((e) => { warn(e.stack || e.message); process.exitCode = 1; }).finally(() => rl?.close());
