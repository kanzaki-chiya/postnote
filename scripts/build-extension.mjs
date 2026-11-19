#!/usr/bin/env node
/**
 * Packages the Chrome extension.
 *
 * Steps:
 *   1. clear `dist/extension/` only (the userscript bundle in `dist/` stays),
 *   2. run the three Vite builds from `vite.config.extension.ts`,
 *   3. write `manifest.json` from `extension/manifest.ts`,
 *   4. copy `_locales/` and the PNG icons,
 *   5. pack the directory into `dist/postnote-chrome-<version>.zip`.
 *
 * Run with `node scripts/build-extension.mjs`. Node 24 strips the TypeScript
 * types of the imported `.ts` modules natively, so the config and the manifest
 * builder are shared with the extension sources instead of being duplicated.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { extensionBuildConfigs } from '../vite.config.extension.ts';
import { buildManifest } from '../extension/manifest.ts';
import { zipDirectory } from './zip.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionSource = join(repoRoot, 'extension');
const outDir = join(repoRoot, 'dist', 'extension');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const zipPath = join(repoRoot, 'dist', `postnote-chrome-${pkg.version}.zip`);

const TARGETS = ['page-hook', 'content', 'background'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  for (const dirent of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, dirent.name);
    const to = join(target, dirent.name);
    if (dirent.isDirectory()) {
      copyDirectory(from, to);
    } else if (dirent.isFile()) {
      copyFileSync(from, to);
    }
  }
}

function copyPngIcons() {
  const source = join(extensionSource, 'icons');
  if (!existsSync(source)) return [];
  // `icon.svg` is the source artwork; Chrome takes the rasterised PNGs.
  const icons = readdirSync(source)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort();
  if (icons.length === 0) {
    console.warn('[build-extension] no PNG icons found in extension/icons');
    return [];
  }
  mkdirSync(join(outDir, 'icons'), { recursive: true });
  for (const name of icons) {
    copyFileSync(join(source, name), join(outDir, 'icons', name));
  }
  return icons;
}

/** Files the manifest points at, so a renamed bundle cannot ship silently. */
function manifestReferences(manifest) {
  const paths = new Set();
  const addIcon = (icon) => {
    if (typeof icon === 'string') {
      paths.add(icon);
    } else if (icon && typeof icon === 'object') {
      for (const value of Object.values(icon)) {
        if (typeof value === 'string') paths.add(value);
      }
    }
  };
  addIcon(manifest.icons);
  addIcon(manifest.action?.default_icon);
  if (typeof manifest.background?.service_worker === 'string') {
    paths.add(manifest.background.service_worker);
  }
  for (const script of manifest.content_scripts ?? []) {
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) {
      paths.add(path);
    }
  }
  return [...paths];
}

function listFiles(directory) {
  const files = [];
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, dirent.name);
    if (dirent.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (dirent.isFile()) {
      files.push({
        path: relative(outDir, fullPath).split(sep).join('/'),
        size: statSync(fullPath).size,
      });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function printSummary() {
  const files = listFiles(outDir);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const width = Math.max(...files.map((file) => file.path.length));
  console.log(`\ndist/extension (${files.length} files, ${formatSize(total)}):`);
  for (const file of files) {
    console.log(`  ${file.path.padEnd(width)}  ${formatSize(file.size).padStart(9)}`);
  }
  console.log(
    `\ndist/${relative(join(repoRoot, 'dist'), zipPath)}  ${formatSize(statSync(zipPath).size)}`,
  );
}

// 1. Only the extension directory is rebuilt; dist/postnote.user.js is not ours.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 2. Three separate builds, all writing into dist/extension. The configs use
// paths relative to the Vite root, so the root is pinned here rather than
// depending on the caller's working directory.
const configs = extensionBuildConfigs();
for (const [index, config] of configs.entries()) {
  console.log(`[build-extension] building ${TARGETS[index]}`);
  await build({ ...config, root: repoRoot, logLevel: 'warn' });
}

// 3. Manifest. Written last so the bundle names above are final.
const manifest = buildManifest(pkg);
writeFileSync(
  join(outDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

// 4. Static assets referenced by the manifest.
const localesSource = join(extensionSource, '_locales');
if (existsSync(localesSource)) {
  copyDirectory(localesSource, join(outDir, '_locales'));
} else if (manifest.default_locale) {
  throw new Error(
    `manifest.json declares default_locale "${manifest.default_locale}" but extension/_locales is missing`,
  );
}
const icons = copyPngIcons();

const missing = manifestReferences(manifest).filter(
  (path) => !existsSync(join(outDir, path)),
);
if (missing.length > 0) {
  throw new Error(
    `manifest.json references files the build did not produce: ${missing.join(', ')}`,
  );
}

// 5. Archive for `chrome://extensions` "Load unpacked" users and the Web Store.
const archive = zipDirectory(outDir, zipPath);

console.log(
  `[build-extension] ${TARGETS.join(', ')} · ${icons.length} icons · ${archive.entries.length} files zipped`,
);
printSummary();
