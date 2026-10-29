import { readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-timeout=30000', ...files], {encoding: 'utf8'});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0 && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Test failure\n```text\n' + (result.stdout ?? '') + (result.stderr ?? '') + '\n```\n');
}
process.exit(result.status ?? 1);
