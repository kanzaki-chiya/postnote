/**
 * The extension manifest, built from `package.json`'s version.
 *
 * The permission surface is deliberately this small: two content scripts on X's
 * own origins and read access to the two image hosts. There is no `permissions`
 * field at all — the PNG is saved from the content script with an anchor click,
 * and nothing is stored between posts.
 */

export const HOMEPAGE_URL = 'https://github.com/kanzaki-chiya/postnote';

/** X serves its timelines from these origins; `*.` covers the mobile host. */
const MATCHES: string[] = [
  'https://x.com/*',
  'https://*.x.com/*',
  'https://twitter.com/*',
  'https://*.twitter.com/*',
];

/** The page-world hook; the only script that runs outside the extension's world. */
type MainContentScript = {
  matches: string[];
  run_at: 'document_start';
  js: string[];
  world: 'MAIN';
};

/** The extension-world reader, which also brings the card's stylesheet. */
type IsolatedContentScript = {
  matches: string[];
  run_at: 'document_start';
  js: string[];
  css: string[];
};

export type ExtensionManifest = {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  default_locale: 'en';
  homepage_url: string;
  icons: Record<string, string>;
  action: { default_title: string; default_icon: Record<string, string> };
  background: { service_worker: string; type: 'module' };
  host_permissions: string[];
  content_scripts: [MainContentScript, IsolatedContentScript];
};

export function buildManifest(pkg: { version: string }): ExtensionManifest {
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    version: pkg.version,
    description: '__MSG_extDescription__',
    default_locale: 'en',
    homepage_url: HOMEPAGE_URL,
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    action: {
      default_title: '推笺 · PostNote',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
    },
    background: { service_worker: 'background.js', type: 'module' },
    host_permissions: ['https://pbs.twimg.com/*', 'https://abs.twimg.com/*'],
    content_scripts: [
      {
        matches: [...MATCHES],
        run_at: 'document_start',
        js: ['page-hook.js'],
        world: 'MAIN',
      },
      {
        matches: [...MATCHES],
        run_at: 'document_start',
        js: ['content.js'],
        css: ['content.css'],
      },
    ],
  };
}
