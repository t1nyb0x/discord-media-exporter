import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { verifyRelease } from './verify-release.mjs';
import { writeReleaseChecksum } from './write-checksum.mjs';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const checks = ['i18n:check', 'lint', 'typecheck', 'test', 'format:check', 'zip'];

for (const script of checks) {
  const result = spawnSync(pnpmCommand, [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await verifyRelease();
await writeReleaseChecksum();
