/**
 * Release verification and CHANGELOG extraction for the GitHub workflows.
 *
 * `release.yml` must fail before it creates anything when the pushed tag, the
 * `package.json` version and the matching `CHANGELOG.md` section disagree.
 * Expressing that in a workflow `run:` block means stringly-typed shell that
 * cannot be tested; keeping the rules here leaves the YAML with a single call
 * and lets `tests/release-notes.test.mjs` check them.
 *
 * Only `node:` builtins are used, so this runs before `npm ci`.
 *
 * Usage:
 *   node scripts/release-notes.mjs --tag v0.6.0 [--out release-notes.md]
 *   node scripts/release-notes.mjs --version 0.5.1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Prefix of every release title, matching the existing 0.5.1 release. */
const TITLE_PREFIX = '推笺 PostNote';

/** Start of any `## ` section heading, used to find where a section ends. */
const ANY_SECTION_HEADING = /^##\s+/m;

const USAGE = `Usage: node scripts/release-notes.mjs [options]

Verifies a release tag against package.json and the CHANGELOG, then prints the
release body to stdout (or writes it with --out).

Options:
  --tag <vX.Y.Z>      Release tag to verify. Defaults to GITHUB_REF_NAME.
  --version <X.Y.Z>   Inspect a historical version instead of a tag; skips the
                      package.json comparison.
  --package <path>    package.json to read (default: package.json).
  --changelog <path>  CHANGELOG to read (default: CHANGELOG.md).
  --out <path>        Write the body to this file instead of stdout.
  -h, --help          Show this help.
`;

/**
 * Turns a tag such as `v0.6.0` into `0.6.0`.
 *
 * Tags without the leading `v` are rejected rather than accepted quietly: the
 * release workflow triggers on `v*`, so a bare version means the version and
 * the tag were written differently somewhere upstream.
 */
export function normalizeTagVersion(tag) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    throw new Error('Missing tag: expected a release tag such as "v0.6.0".');
  }
  if (/\s/.test(tag)) {
    throw new Error(`Malformed tag "${tag}": whitespace is not allowed.`);
  }
  if (!tag.startsWith('v')) {
    throw new Error(
      `Malformed tag "${tag}": a release tag must start with "v" (for example "v0.6.0").`,
    );
  }

  const version = tag.slice(1);
  if (version === '') {
    throw new Error(`Malformed tag "${tag}": there is no version after the "v".`);
  }

  return version;
}

/**
 * Returns the body of the `## <version>` section of a CHANGELOG.
 *
 * The heading is matched as a whole line (`^##\s+<version>\s*$`), so `0.5`
 * never picks up `## 0.5.1`, and `0.5.1` never picks up `## 0.5.10`. The body
 * runs until the next `## ` heading or the end of the file; only the blank
 * lines around it are trimmed, so the section keeps its own formatting.
 *
 * Line endings are normalised to `\n` first: Windows worktrees check the file
 * out with CRLF while CI runs on Linux, and the release body should not depend
 * on where it was produced.
 */
export function extractChangelogSection(changelogText, version) {
  if (typeof changelogText !== 'string') {
    throw new TypeError('CHANGELOG text must be a string.');
  }
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('Missing version: expected a version such as "0.6.0".');
  }

  const text = changelogText.replace(/\r\n/g, '\n');
  const heading = new RegExp(`^##\\s+${escapeRegExp(version)}\\s*$`, 'm');
  const match = heading.exec(text);
  if (match === null) {
    throw new Error(
      `CHANGELOG has no section for ${version}: expected a line "## ${version}".`,
    );
  }

  const start = match.index + match[0].length;
  const nextHeading = ANY_SECTION_HEADING.exec(text.slice(start));
  const end = nextHeading === null ? text.length : start + nextHeading.index;

  const body = text
    .slice(start, end)
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');

  if (body === '') {
    throw new Error(`CHANGELOG section for ${version} is empty.`);
  }

  return body;
}

/**
 * Checks that a tag matches the version being released and returns everything
 * needed to create the GitHub Release.
 */
export function verifyReleaseTag({ tag, packageVersion, changelogText }) {
  const version = normalizeTagVersion(tag);

  if (typeof packageVersion !== 'string' || packageVersion.trim() === '') {
    throw new Error('package.json is missing a "version" field.');
  }
  if (version !== packageVersion) {
    throw new Error(
      `Tag ${tag} points at ${version}, but package.json says ${packageVersion}. Bump the version or fix the tag.`,
    );
  }

  const body = extractChangelogSection(changelogText, version);
  return { version, title: `${TITLE_PREFIX} ${version}`, body };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const options = {
    tag: undefined,
    version: undefined,
    packagePath: 'package.json',
    changelogPath: 'CHANGELOG.md',
    outPath: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (
      arg === '--tag' ||
      arg === '--version' ||
      arg === '--package' ||
      arg === '--changelog' ||
      arg === '--out'
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`Option ${arg} needs a value.`);
      }
      index += 1;

      if (arg === '--tag') options.tag = value;
      else if (arg === '--version') options.version = value;
      else if (arg === '--package') options.packagePath = value;
      else if (arg === '--changelog') options.changelogPath = value;
      else options.outPath = value;
      continue;
    }

    throw new Error(`Unknown argument "${arg}". Run with --help for usage.`);
  }

  return options;
}

function readText(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error.message}`);
  }
}

function readPackageVersion(path) {
  const raw = readText(path, 'package.json');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error.message}`);
  }

  if (typeof parsed.version !== 'string' || parsed.version.trim() === '') {
    throw new Error(`${path} has no "version" field.`);
  }

  return parsed.version;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const changelogText = readText(options.changelogPath, 'CHANGELOG');
  let version;
  let body;

  if (options.version !== undefined) {
    version = options.version;
    if (options.tag !== undefined) {
      const tagVersion = normalizeTagVersion(options.tag);
      if (tagVersion !== version) {
        throw new Error(
          `--tag ${options.tag} implies ${tagVersion}, but --version says ${version}.`,
        );
      }
    }
    // Deliberately skips package.json: used to inspect a historical release,
    // e.g. `--version 0.5.1` while package.json already says 0.6.0.
    body = extractChangelogSection(changelogText, version);
  } else {
    const tag = options.tag ?? process.env.GITHUB_REF_NAME;
    if (tag === undefined || tag === '') {
      throw new Error(
        'Missing tag: pass --tag vX.Y.Z (or --version X.Y.Z), or set GITHUB_REF_NAME.',
      );
    }
    const packageVersion = readPackageVersion(options.packagePath);
    ({ version, body } = verifyReleaseTag({ tag, packageVersion, changelogText }));
  }

  if (options.outPath === undefined) {
    process.stdout.write(`${body}\n`);
    return;
  }

  try {
    writeFileSync(options.outPath, `${body}\n`, 'utf8');
  } catch (error) {
    throw new Error(`Cannot write ${options.outPath}: ${error.message}`);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release-notes: ${message}`);
    process.exitCode = 1;
  }
}
