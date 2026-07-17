import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.output', 'chrome-mv3');
const expectedPermissions = ['activeTab', 'downloads', 'offscreen', 'scripting', 'storage'];
const expectedOptionalHostPermissions = [
  'https://cdn.discordapp.com/*',
  'https://discord.com/*',
  'https://media.discordapp.net/*',
];
const requiredFiles = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.txt',
  'background.js',
  'manifest.json',
  'offscreen.html',
  'popup.html',
  'scan.js',
  '_locales/en/messages.json',
  '_locales/ja/messages.json',
];
const forbiddenPatterns = [
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)fixtures?(\/|$)/i,
  /\.map$/i,
  /\.pem$/i,
  /\.ts$/i,
];

export async function verifyRelease() {
  const files = await listFiles(outputDirectory);
  const relativeFiles = files.map((file) => path.relative(outputDirectory, file));

  for (const requiredFile of requiredFiles) {
    if (!relativeFiles.includes(requiredFile)) {
      throw new Error(`Required release file is missing: ${requiredFile}`);
    }
  }

  const forbiddenFile = relativeFiles.find((file) =>
    forbiddenPatterns.some((pattern) => pattern.test(file)),
  );
  if (forbiddenFile !== undefined) {
    throw new Error(`Forbidden file found in release output: ${forbiddenFile}`);
  }

  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const actualPermissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
    throw new Error(`Unexpected manifest permissions: ${actualPermissions.join(', ')}`);
  }
  if (manifest.host_permissions !== undefined) {
    throw new Error('Release manifest must not contain host_permissions.');
  }
  const actualOptionalHostPermissions = [...(manifest.optional_host_permissions ?? [])].sort();
  if (
    JSON.stringify(actualOptionalHostPermissions) !==
    JSON.stringify(expectedOptionalHostPermissions)
  ) {
    throw new Error(
      `Unexpected optional host permissions: ${actualOptionalHostPermissions.join(', ')}`,
    );
  }
  if (manifest.content_scripts !== undefined) {
    throw new Error('Release manifest must not contain persistent content_scripts.');
  }
  if (manifest.default_locale !== 'en') {
    throw new Error(`Unexpected default_locale: ${manifest.default_locale ?? 'missing'}`);
  }
  if (manifest.name !== '__MSG_extension_name__') {
    throw new Error(`Unexpected localized manifest name: ${manifest.name ?? 'missing'}`);
  }
  if (manifest.description !== '__MSG_extension_description__') {
    throw new Error(
      `Unexpected localized manifest description: ${manifest.description ?? 'missing'}`,
    );
  }

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  if (packageJson.license !== 'MIT') {
    throw new Error(`Unexpected package license: ${packageJson.license ?? 'missing'}.`);
  }
  const sourceLicense = await readFile(path.join(projectRoot, 'LICENSE'), 'utf8');
  const packagedLicense = await readFile(path.join(outputDirectory, 'LICENSE'), 'utf8');
  if (packagedLicense !== sourceLicense) {
    throw new Error('Packaged LICENSE does not match the repository LICENSE.');
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `Manifest version ${manifest.version} does not match package version ${packageJson.version}.`,
    );
  }

  console.log(`Release verification passed (${relativeFiles.length} files, v${manifest.version}).`);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyRelease();
}
