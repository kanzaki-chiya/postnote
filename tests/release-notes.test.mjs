// @vitest-environment node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractChangelogSection,
  normalizeTagVersion,
  verifyReleaseTag,
} from '../scripts/release-notes.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'release-notes.mjs');
const packagePath = join(repoRoot, 'package.json');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const changelogText = readFileSync(changelogPath, 'utf8');
const currentVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version;

/** Exactly what v0.5.1's release notes should contain. */
const SECTION_0_5_1 = [
  '- 修：引用框显示自动翻译时，导出不再错误地使用英文原文。引用及嵌套引用分别按各自的「翻译自…」标签选择正文，',
  '  优先使用已加载数据里的完整译文；数据缺译文时使用页面引用框的可见文字。与主推的翻译选择互不影响，导出不画翻译来源标签。',
].join('\n');

const SECTION_0_5_0_FIRST = '- 新：导出图画出 X 的链接预览卡片';
const SECTION_0_5_0_LAST =
  '- 修：繁体页面的投票结果行、卡片「來自」前缀按页面语言显示。';
const SECTION_0_1_0_FIRST = '首次可用版本。';
const SECTION_0_1_0_LAST =
  '- 图片解码、请求超时、取消、尺寸上限都有明确结果。';

function runCli(args, env = process.env) {
  return execFileSync('node', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });
}

function spawnCli(args, env = process.env) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });
}

function withoutRefName() {
  const env = { ...process.env };
  delete env.GITHUB_REF_NAME;
  return env;
}

describe('normalizeTagVersion', () => {
  it('strips the leading v', () => {
    expect(normalizeTagVersion('v0.6.0')).toBe('0.6.0');
    expect(normalizeTagVersion('v0.5.1')).toBe('0.5.1');
  });

  it('rejects a tag without the leading v', () => {
    expect(() => normalizeTagVersion('0.6.0')).toThrow(/must start with "v"/);
    expect(() => normalizeTagVersion('V0.6.0')).toThrow(/must start with "v"/);
  });

  it('rejects an empty tag', () => {
    expect(() => normalizeTagVersion('')).toThrow(/Missing tag/);
    expect(() => normalizeTagVersion('   ')).toThrow(/Missing tag/);
    expect(() => normalizeTagVersion('v')).toThrow(/no version/);
  });
});

describe('extractChangelogSection', () => {
  it('extracts 0.5.1 exactly', () => {
    expect(extractChangelogSection(changelogText, '0.5.1')).toBe(SECTION_0_5_1);
  });

  it('stops 0.5.0 at the next heading', () => {
    const section = extractChangelogSection(changelogText, '0.5.0');

    expect(section.startsWith(SECTION_0_5_0_FIRST)).toBe(true);
    expect(section.endsWith(SECTION_0_5_0_LAST)).toBe(true);
    expect(section).not.toMatch(/^##\s/m);
    expect(section).toBe(section.trim());
    // Wrapped bullet text keeps its own line breaks and indentation.
    expect(section).toContain('\n  链接取正文 URL 实体的展开地址。');
  });

  it('extracts the last entry, 0.1.0, up to the end of the file', () => {
    const section = extractChangelogSection(changelogText, '0.1.0');

    expect(section.startsWith(SECTION_0_1_0_FIRST)).toBe(true);
    expect(section.endsWith(SECTION_0_1_0_LAST)).toBe(true);
    expect(section).not.toMatch(/^##\s/m);
    expect(section).toBe(section.trim());
    // Blank lines inside the section belong to the release notes.
    expect(section).toContain('首次可用版本。\n\n- 推文操作栏旁的入口');
  });

  it('normalises CRLF line endings so Windows and Linux agree', () => {
    const crlf = changelogText.replace(/\r?\n/g, '\r\n');

    expect(extractChangelogSection(crlf, '0.5.1')).toBe(SECTION_0_5_1);
    expect(extractChangelogSection(crlf, '0.1.0')).toBe(
      extractChangelogSection(changelogText, '0.1.0'),
    );
  });

  it('fails when the version has no section', () => {
    expect(() => extractChangelogSection(changelogText, '9.9.9')).toThrow(
      /no section/,
    );
  });

  it('fails when the section is empty', () => {
    const text = '# 变更记录\n\n## 1.0.0\n\n## 0.9.0\n\n- 旧的一节\n';

    expect(() => extractChangelogSection(text, '1.0.0')).toThrow(/empty/);
  });

  it('does not treat a longer version as a prefix match', () => {
    // `0.5` must not match the real `## 0.5.1` heading.
    expect(() => extractChangelogSection(changelogText, '0.5')).toThrow(
      /no section/,
    );

    const text = '## 0.5.10\n\n- 0.5.10 的内容\n\n## 0.5.1\n\n- 0.5.1 的内容\n';

    expect(extractChangelogSection(text, '0.5.1')).toBe('- 0.5.1 的内容');
    expect(extractChangelogSection(text, '0.5.10')).toBe('- 0.5.10 的内容');
  });

  it('treats a dot in the version literally', () => {
    const text = '## 0x5\n\n- 不是 0.5 的一节\n';

    expect(() => extractChangelogSection(text, '0.5')).toThrow(/no section/);
  });
});

describe('verifyReleaseTag', () => {
  const text =
    '# 变更记录\n\n## 0.6.0\n\n- 新：0.6.0 的第一条\n\n## 0.5.1\n\n- 旧的一节\n';

  it('returns the version, the release title and the body', () => {
    expect(
      verifyReleaseTag({
        tag: 'v0.6.0',
        packageVersion: '0.6.0',
        changelogText: text,
      }),
    ).toEqual({
      version: '0.6.0',
      title: '推笺 PostNote 0.6.0',
      body: '- 新：0.6.0 的第一条',
    });
  });

  it('fails when the tag does not match package.json', () => {
    expect(() =>
      verifyReleaseTag({
        tag: 'v0.6.0',
        packageVersion: '0.5.1',
        changelogText: text,
      }),
    ).toThrow(/package\.json/);
  });

  it('reads the body from the real changelog', () => {
    const release = verifyReleaseTag({
      tag: 'v0.5.1',
      packageVersion: '0.5.1',
      changelogText,
    });

    expect(release.version).toBe('0.5.1');
    expect(release.title).toBe('推笺 PostNote 0.5.1');
    expect(release.body).toBe(SECTION_0_5_1);
  });
});

describe('CLI', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'postnote-release-notes-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints the release body for a matching tag', () => {
    const stdout = runCli([
      '--tag',
      `v${currentVersion}`,
      '--package',
      packagePath,
      '--changelog',
      changelogPath,
    ]);

    expect(stdout.trim()).toBe(
      extractChangelogSection(changelogText, currentVersion),
    );
  });

  it('falls back to GITHUB_REF_NAME', () => {
    const stdout = runCli(
      ['--package', packagePath, '--changelog', changelogPath],
      { ...process.env, GITHUB_REF_NAME: `v${currentVersion}` },
    );

    expect(stdout.trim()).toBe(
      extractChangelogSection(changelogText, currentVersion),
    );
  });

  it('writes the body to --out and prints nothing', () => {
    const outPath = join(tempDir, 'release-notes.md');
    const stdout = runCli([
      '--tag',
      `v${currentVersion}`,
      '--package',
      packagePath,
      '--changelog',
      changelogPath,
      '--out',
      outPath,
    ]);

    expect(stdout).toBe('');
    expect(readFileSync(outPath, 'utf8').trim()).toBe(
      extractChangelogSection(changelogText, currentVersion),
    );
  });

  it('inspects a historical version with --version, skipping package.json', () => {
    const historicalPackage = join(tempDir, 'package.json');
    writeFileSync(
      historicalPackage,
      JSON.stringify({ name: 'postnote', version: '9.9.9' }),
      'utf8',
    );

    // --package says 9.9.9 on purpose: --version must not compare against it.
    const stdout = runCli([
      '--version',
      '0.5.1',
      '--package',
      historicalPackage,
      '--changelog',
      changelogPath,
    ]);

    expect(stdout.trim()).toBe(SECTION_0_5_1);
  });

  it('exits non-zero when the tag does not match package.json', () => {
    const result = spawnCli([
      '--tag',
      'v9.9.9',
      '--package',
      packagePath,
      '--changelog',
      changelogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/package\.json/);
  });

  it('exits non-zero when the version has no changelog section', () => {
    const result = spawnCli(['--version', '9.9.9', '--changelog', changelogPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no section/);
  });

  it('exits non-zero when no tag is given', () => {
    const result = spawnCli(
      ['--package', packagePath, '--changelog', changelogPath],
      withoutRefName(),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Missing tag/);
  });
});
