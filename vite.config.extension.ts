/**
 * Vite build configurations for the packaged Chrome extension.
 *
 * The extension ships three independent bundles and each one gets its own Vite
 * invocation (`scripts/build-extension.mjs`), because an MV3 service worker has
 * to be an ES module while the content script and the MAIN-world page hook must
 * be classic scripts that declare no exports.
 *
 * Paths are relative to the Vite root, which the build script pins to the
 * repository root, so this file needs no Node-specific APIs and stays within
 * the project's `types: ["vite/client"]` setup.
 *
 * Vite 8 is Rolldown-based, so:
 * - `build.rollupOptions` is deprecated; everything here uses
 *   `build.rolldownOptions`.
 * - `esbuild` is no longer bundled with Vite; the default `oxc` minifier is
 *   used instead (plain minification, no obfuscation).
 * - all three passes write into the same `dist/extension/` directory, so
 *   `emptyOutDir` stays `false` and `scripts/build-extension.mjs` clears the
 *   directory once, before the first pass.
 *
 * `@zumer/snapdom` must be inlined into `content.js`: content scripts cannot
 * load a CDN copy and the extension has no `web_accessible_resources` for it.
 * Nothing is marked external, so the bundler pulls the dependency in.
 */
import type { BuildEnvironmentOptions, InlineConfig } from 'vite';

const OUT_DIR = 'dist/extension';

/** Everything shared by the three bundles. */
function baseConfig(): InlineConfig {
  return {
    // These configs are consumed programmatically; never load vite.config.ts.
    configFile: false,
    // A manifest-driven extension has no HTML entry and no public/ directory.
    publicDir: false,
    define: {
      // Same substitution Vite applies to web builds. Spelled out so a stray
      // `process.env.NODE_ENV` in a dependency cannot survive into the bundle.
      'process.env.NODE_ENV': '"production"',
    },
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      target: 'es2020',
      sourcemap: false,
    },
  };
}

function withBuild(overrides: BuildEnvironmentOptions): InlineConfig {
  const config = baseConfig();
  return { ...config, build: { ...config.build, ...overrides } };
}

/**
 * CSS from the content script must land next to the JS as `content.css`;
 * the manifest and `content.ts` inject it under that exact name.
 */
function contentAssetFileNames(assetInfo: {
  names?: string[];
  name?: string;
}): string {
  const names = assetInfo.names ?? [];
  const isCss =
    names.some((name) => name.endsWith('.css')) ||
    assetInfo.name?.endsWith('.css') === true;
  return isCss ? 'content.css' : '[name][extname]';
}

/**
 * The three builds, in the order `scripts/build-extension.mjs` runs them.
 */
export function extensionBuildConfigs(): [
  InlineConfig,
  InlineConfig,
  InlineConfig,
] {
  // Main-world hook: injected as a classic <script>, so IIFE with no exports.
  const pageHook = withBuild({
    lib: {
      entry: 'extension/page-hook.ts',
      formats: ['iife'],
      name: 'PostNotePageHook',
      fileName: () => 'page-hook.js',
    },
  });

  // Content script: IIFE again, but it imports @zumer/snapdom and a stylesheet.
  const content = withBuild({
    cssCodeSplit: false,
    lib: {
      entry: 'extension/content.ts',
      formats: ['iife'],
      name: 'PostNoteContent',
      fileName: () => 'content.js',
      cssFileName: 'content',
    },
    rolldownOptions: {
      output: {
        assetFileNames: contentAssetFileNames,
      },
    },
  });

  // Service worker: MV3 runs it as an ES module.
  const background = withBuild({
    lib: {
      entry: 'extension/background.ts',
      formats: ['es'],
      fileName: () => 'background.js',
    },
  });

  return [pageHook, content, background];
}
