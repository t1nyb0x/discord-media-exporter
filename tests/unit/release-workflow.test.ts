import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('release workflow trigger', () => {
  it('runs only for paths that can affect the packaged extension', async () => {
    const source = await readFile(path.join(projectRoot, '.github/workflows/release.yml'), 'utf8');
    const workflow = parse(source) as {
      on?: { push?: { paths?: unknown } };
    };

    expect(workflow.on?.push?.paths).toEqual([
      'entrypoints/**',
      'src/**',
      'public/**',
      'locales/**',
      'wxt.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'LICENSE',
    ]);
  });
});
