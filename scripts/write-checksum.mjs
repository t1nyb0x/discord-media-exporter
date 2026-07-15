import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function writeReleaseChecksum() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const filename = `${packageJson.name}-${packageJson.version}-chrome.zip`;
  const archivePath = path.join(projectRoot, '.output', filename);
  const checksumPath = `${archivePath}.sha256`;
  const archive = await readFile(archivePath);
  const checksum = createHash('sha256').update(archive).digest('hex');

  await writeFile(checksumPath, `${checksum}  ${filename}\n`, 'utf8');
  console.log(`SHA-256: ${checksum}`);
  console.log(`Checksum file: ${path.relative(projectRoot, checksumPath)}`);
  return checksum;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeReleaseChecksum();
}
