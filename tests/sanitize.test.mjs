// @vitest-environment node

import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('sanitizes names without corrupting Business and recalculates Emoji entity offsets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'postnote-sanitize-'));
  try {
    const input = join(dir, 'capture.json'); const output = join(dir, 'fixture.json');
    writeFileSync(input, JSON.stringify({ core: { name: 'Business', screen_name: 'long_handle' }, verification: { verified_type: 'Business' }, legacy: {
      full_text: '👋 @long_handle Business', display_text_range: [0, 23],
      entities: { user_mentions: [{ name: 'Business', screen_name: 'long_handle', indices: [2, 14] }] },
    } }));
    execFileSync(process.execPath, ['scripts/sanitize-capture.mjs', input, output]);
    const data = JSON.parse(readFileSync(output, 'utf8'));
    expect(data.verification.verified_type).toBe('Business');
    expect(data.core.name).toBe('User 1');
    expect(data.legacy.full_text).toBe('👋 @user1 User 1');
    expect(data.legacy.entities.user_mentions[0].indices).toEqual([2, 8]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
