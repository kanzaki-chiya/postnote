import { defineConfig } from 'vite';
import monkey, { cdn } from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

const repo = 'https://github.com/kanzaki-chiya/postnote';

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    // Userscript hosts require readable source; keep the stylesheet unminified too.
    cssMinify: false,
  },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: '推笺 · PostNote',
        namespace: 'postnote',
        version: pkg.version,
        author: 'kanzaki-chiya',
        description: '把值得留下的推文，存成一张图。',
        license: 'MIT',
        homepageURL: repo,
        supportURL: `${repo}/issues`,
        match: ['*://*.twitter.com/*', '*://*.x.com/*'],
        // The page's own conversation data is observed as it loads, so the
        // watcher has to be installed before the first request goes out.
        'run-at': 'document-start',
        connect: ['pbs.twimg.com', 'abs.twimg.com'],
        grant: ['GM.xmlHttpRequest', 'unsafeWindow'],
      },
      build: {
        // SnapDOM ships minified, which Greasy Fork only accepts through
        // @require from a CDN. Its build assigns `window.snapdom`, so the
        // named import resolves against `window`.
        externalGlobals: {
          '@zumer/snapdom': cdn.jsdelivr('window', 'dist/snapdom.js'),
        },
      },
    }),
  ],
});
