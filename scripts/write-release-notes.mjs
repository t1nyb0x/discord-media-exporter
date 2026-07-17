import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extracts one version body so CHANGELOG.md remains the release-note source of truth. */
export function extractChangelogSection(changelog, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escapedVersion}\\](?:\\s+-.*)?$`, 'm');
  const match = heading.exec(changelog);
  if (match === null) throw new Error(`CHANGELOG.md has no section for version ${version}.`);

  const bodyStart = match.index + match[0].length;
  const nextHeading = changelog.slice(bodyStart).search(/^## \[/m);
  const bodyEnd = nextHeading === -1 ? changelog.length : bodyStart + nextHeading;
  const body = changelog.slice(bodyStart, bodyEnd).trim();
  if (body.length === 0) throw new Error(`CHANGELOG.md section ${version} is empty.`);
  return `${body}\n`;
}

/** Writes the current package version's GitHub Release body into the build output. */
export async function writeReleaseNotes() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const changelog = await readFile(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  const outputDirectory = path.join(projectRoot, '.output');
  const outputPath = path.join(outputDirectory, 'release-notes.md');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, extractChangelogSection(changelog, packageJson.version), 'utf8');
  console.log(`Release notes: ${path.relative(projectRoot, outputPath)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeReleaseNotes();
}
