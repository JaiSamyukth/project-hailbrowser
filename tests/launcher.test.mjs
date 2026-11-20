import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_NAME, DEFAULT_CONFIG, EXTENSION_ID, applyTree, findInstalledExtension, listFiles, listProfiles, loadConfig,
  normalizeUrl, saveConfig, trustExtension, userDataDir, validateConfig, writeStamp, zipCommit,
} from '../launcher/lib.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hb-launcher-'));
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the manifest key gives the extension the id the launcher expects', async () => {
  const { createHash } = await import('node:crypto');
  const { key } = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  assert.equal([...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join(''), EXTENSION_ID);
});

test('first run writes the default settings; later runs merge in new defaults', () => {
  const root = tmp();
  const first = loadConfig(root);
  assert.equal(first._created, true);
  assert.ok(fs.existsSync(path.join(root, CONFIG_NAME)));
  fs.writeFileSync(path.join(root, CONFIG_NAME), JSON.stringify({ startUrls: ['https://example.com'], updates: { branch: 'dev' } }));
  const c = loadConfig(root);
  assert.deepEqual(c.startUrls, ['https://example.com']);
  assert.equal(c.updates.branch, 'dev');
  assert.equal(c.updates.repo, DEFAULT_CONFIG.updates.repo);
  assert.equal(c.browser, 'chrome');
  saveConfig(c, root);
  assert.equal(JSON.parse(read(root, CONFIG_NAME))._created, undefined);
});

test('bad settings files get readable errors instead of being overwritten', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, CONFIG_NAME), '{ "browser": "chrome", }');
  assert.throws(() => loadConfig(root), /not valid JSON/);
  assert.equal(read(root, CONFIG_NAME), '{ "browser": "chrome", }');
  fs.writeFileSync(path.join(root, CONFIG_NAME), JSON.stringify({ browser: 'safari', newWindow: 'yes', updates: { check: 'sometimes' } }));
  assert.throws(() => loadConfig(root), /browser.*\n.*newWindow.*\n.*updates.check/s);
  assert.deepEqual(validateConfig(structuredClone(DEFAULT_CONFIG)), []);
});

test('start pages accept bare domains and reject junk', () => {
  assert.equal(normalizeUrl('github.com'), 'https://github.com');
  assert.equal(normalizeUrl('mail.google.com/mail/u/0'), 'https://mail.google.com/mail/u/0');
  assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('localhost:8080/x'), 'https://localhost:8080/x');
  assert.equal(normalizeUrl('chrome://extensions'), 'chrome://extensions');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('hello'), null);
  assert.equal(normalizeUrl(''), null);
});

test('browser data folders per platform', () => {
  // Asking for another platform's folder still joins with this machine's separator.
  const dir = (...args) => userDataDir(...args).replace(/\\/g, '/');
  const c = { ...DEFAULT_CONFIG };
  assert.equal(dir(c, 'darwin', {}, '/Users/a'), '/Users/a/Library/Application Support/Google/Chrome');
  assert.equal(dir(c, 'linux', {}, '/home/a'), '/home/a/.config/google-chrome');
  assert.equal(dir({ ...c, browser: 'brave' }, 'linux', { XDG_CONFIG_HOME: '/x' }, '/home/a'), '/x/BraveSoftware/Brave-Browser');
  assert.equal(dir({ ...c, browser: 'edge' }, 'win32', { LOCALAPPDATA: 'C:/L' }, 'C:/U'), 'C:/L/Microsoft/Edge/User Data');
  assert.equal(dir({ ...c, userDataDir: '/custom' }, 'linux'), '/custom');
});

test('finds the extension in a profile by id or by folder, and notices when it is off', () => {
  const data = tmp();
  const prof = path.join(data, 'Default');
  fs.mkdirSync(prof);
  assert.equal(findInstalledExtension(prof, '/x/extension'), null);
  fs.writeFileSync(path.join(prof, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { abc: { path: '/x/extension/', location: 4 } } } }));
  assert.deepEqual(findInstalledExtension(prof, '/x/extension'), { id: 'abc', path: '/x/extension/', enabled: true });
  fs.writeFileSync(path.join(prof, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { [EXTENSION_ID]: { path: '/other', disable_reasons: [1] } } } }));
  assert.deepEqual(findInstalledExtension(prof, '/x/extension'), { id: EXTENSION_ID, path: '/other', enabled: false });
  fs.writeFileSync(path.join(data, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Me' }, 'Profile 1': { name: 'Work' } } } }));
  assert.deepEqual(listProfiles(data), [{ dir: 'Default', name: 'Me' }, { dir: 'Profile 1', name: 'Work' }]);
});

test('trusting the extension for coding agents writes the hub trust file once', () => {
  const file = path.join(tmp(), 'trusted-extension.json');
  assert.equal(trustExtension('abc', file), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).extensionId, 'abc');
  assert.equal(trustExtension('abc', file), false);
});

function fakeRepo(root, files) {
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
}

test('an update replaces changed files, keeps settings and your own files, and removes dropped files', () => {
  const root = tmp();
  fakeRepo(root, {
    'extension/manifest.json': '{"version":"1"}', 'launcher/hailbrowser.mjs': 'old', 'old-only.txt': 'gone soon',
    [CONFIG_NAME]: '{"mine":true}', 'my-notes.txt': 'keep', 'node_modules/ws/index.js': 'pkg',
  });
  const src = tmp();
  fakeRepo(src, { 'extension/manifest.json': '{"version":"2"}', 'launcher/hailbrowser.mjs': 'old', 'new/file.js': 'new', [CONFIG_NAME]: '{"theirs":true}' });
  const r = applyTree(src, root, ['extension/manifest.json', 'launcher/hailbrowser.mjs', 'old-only.txt']);
  assert.deepEqual(r.changed.sort(), ['extension/manifest.json', 'new/file.js', 'old-only.txt']);
  assert.equal(read(root, 'extension/manifest.json'), '{"version":"2"}');
  assert.equal(read(root, 'new/file.js'), 'new');
  assert.equal(fs.existsSync(path.join(root, 'old-only.txt')), false);
  assert.equal(read(root, CONFIG_NAME), '{"mine":true}');
  assert.equal(read(root, 'my-notes.txt'), 'keep');
  assert.equal(read(root, 'node_modules/ws/index.js'), 'pkg');
  assert.ok(!listFiles(root).some((f) => f.endsWith('.hbnew')));
});

test('a failed update puts every file back', () => {
  const root = tmp();
  fakeRepo(root, { 'extension/manifest.json': 'v1', 'launcher/hailbrowser.mjs': 'l1', 'a.txt': 'a1' });
  const src = tmp();
  fakeRepo(src, { 'extension/manifest.json': 'v2', 'launcher/hailbrowser.mjs': 'l2', 'a.txt': 'a2', 'b/new.txt': 'b' });
  fs.mkdirSync(path.join(root, 'zz'));
  write(src, 'zz', 'a file where a folder is'); // writing this fails: 'zz' is a directory here
  assert.throws(() => applyTree(src, root, []), /undone/);
  assert.equal(read(root, 'extension/manifest.json'), 'v1');
  assert.equal(read(root, 'launcher/hailbrowser.mjs'), 'l1');
  assert.equal(read(root, 'a.txt'), 'a1');
  assert.equal(fs.existsSync(path.join(root, 'b/new.txt')), false);
});

test('a download without the launcher is refused', () => {
  const root = tmp();
  fakeRepo(root, { 'extension/manifest.json': 'v1', 'launcher/hailbrowser.mjs': 'l1' });
  const src = tmp();
  fakeRepo(src, { 'extension/manifest.json': 'v0' });
  assert.throws(() => applyTree(src, root, []), /no start script/);
  assert.equal(read(root, 'extension/manifest.json'), 'v1');
});

test('the update stamp names the commit and the extension version', () => {
  const root = tmp();
  write(root, 'extension/manifest.json', '{"version":"9.9.9"}');
  const s = writeStamp(root, 'a'.repeat(40));
  const disk = JSON.parse(read(root, 'extension/update-stamp.json'));
  assert.equal(disk.id, s.id);
  assert.equal(disk.version, '9.9.9');
  assert.equal(disk.commit, 'a'.repeat(40));
});

test('the commit is read from a GitHub zip comment', () => {
  assert.equal(zipCommit(Buffer.concat([Buffer.from('PK...'), Buffer.from('e135dcbc9669d790a92c61e7e2aa0cdd947e8896')])), 'e135dcbc9669d790a92c61e7e2aa0cdd947e8896');
  assert.equal(zipCommit(Buffer.from('PK no comment here, just the end of a central directory')), null);
});
