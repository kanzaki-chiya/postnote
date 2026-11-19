/**
 * ISOLATED-world entry script: claims the GraphQL channel, then starts PostNote.
 *
 * The channel is claimed before anything else so the page hook has somewhere to
 * send what it observes. `install` waits for the page body on its own.
 */

import { install } from '../src/main';
import { recordTweets } from '../src/x-network';
import { attachContentChannel } from './channel';
import { extensionPlatform } from './platform';

if (typeof document !== 'undefined') {
  attachContentChannel(document, recordTweets);
  install(extensionPlatform);
}
