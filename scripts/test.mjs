import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {stdio: 'inherit'});
process.exit(result.status ?? 1);
