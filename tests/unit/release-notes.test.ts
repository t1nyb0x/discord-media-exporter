import { describe, expect, it } from 'vitest';
import { extractChangelogSection } from '../../scripts/write-release-notes.mjs';

describe('release note generation', () => {
  it('extracts only the requested CHANGELOG version body', () => {
    const changelog = `# Changelog

## [1.2.0] - 2026-07-17

### Added

- Current feature

## [1.1.0] - 2026-07-16

- Previous feature
`;

    expect(extractChangelogSection(changelog, '1.2.0')).toBe('### Added\n\n- Current feature\n');
  });

  it('rejects a missing or empty release section', () => {
    expect(() => extractChangelogSection('# Changelog\n', '1.2.0')).toThrow(
      'CHANGELOG.md has no section for version 1.2.0.',
    );
    expect(() =>
      extractChangelogSection('# Changelog\n\n## [1.2.0]\n\n## [1.1.0]\n\n- Previous\n', '1.2.0'),
    ).toThrow('CHANGELOG.md section 1.2.0 is empty.');
  });
});
