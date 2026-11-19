/**
 * MAIN-world entry script: observes the page's own GraphQL traffic and forwards
 * the response bodies to the extension's content script.
 *
 * Only the observer and the channel are imported, so this bundle carries
 * nothing but the hook itself — it runs in the page's world before the first
 * request of the page goes out.
 */

import { hookNetwork } from '../src/network-hook';
import { createPageBridge } from './channel';

if (typeof document !== 'undefined') {
  hookNetwork(window, createPageBridge(document));
}
