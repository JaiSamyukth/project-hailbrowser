// Run every tests/*.test.mjs. Node 18 and 20 don't expand globs for `node --test`, so list them here.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync('tests').filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `tests/${f}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
