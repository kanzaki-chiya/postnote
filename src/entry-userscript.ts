/**
 * Userscript entry point: starts observing the page's GraphQL traffic and
 * installs PostNote with the `GM.xmlHttpRequest` platform adapter.
 */

import { install } from './main';
import { userscriptPlatform } from './platform-userscript';
import { watchNetwork } from './x-network';

if (typeof document !== 'undefined') {
  watchNetwork();
  install(userscriptPlatform);
}
