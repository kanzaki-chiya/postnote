/**
 * Turn a BrowserOS-captured GraphQL response into a sanitized test fixture.
 *
 * Real ids, handles, display names, and media file names are replaced with
 * sequential stand-ins; the structure of the payload is untouched, so the
 * fixtures exercise the same paths the page does.
 *
 *   node scripts/sanitize-capture.mjs <capture.json> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: sanitize-capture.mjs <in> <out>');
  process.exit(1);
}

let raw = readFileSync(inFile, 'utf8');
raw = raw
  .replace(/^\[UNTRUSTED_PAGE_CONTENT[^\n]*\n/, '')
  .replace(/\n?\[END_UNTRUSTED_PAGE_CONTENT[^\n]*\n?$/, '');
const data = JSON.parse(raw);

const idMap = new Map();
const screenMap = new Map();
const nameMap = new Map();
const mediaMap = new Map();

const nextId = (value) => {
  if (!idMap.has(value)) idMap.set(value, `1000000000000000${String(idMap.size).padStart(3, '0')}`);
  return idMap.get(value);
};

const nextScreen = (value) => {
  if (!screenMap.has(value)) screenMap.set(value, `user${screenMap.size + 1}`);
  return screenMap.get(value);
};

const nextName = (value) => {
  if (!nameMap.has(value)) nameMap.set(value, `User ${nameMap.size + 1}`);
  return nameMap.get(value);
};

const ID_KEYS = new Set([
  'rest_id',
  'id_str',
  'in_reply_to_status_id_str',
  'in_reply_to_user_id_str',
  'user_id_str',
  'conversation_id_str',
  'quoted_status_id_str',
  'media_id',
  'media_id_string',
  'retweeted_status_id_str',
  'sortIndex',
]);

function sanitize(node, key) {
  if (typeof node === 'string') {
    if (key === 'screen_name' || key === 'in_reply_to_screen_name') return nextScreen(node);
    if ((ID_KEYS.has(key) || /(?:ids|ids_str)$/.test(key ?? '')) && /^\d+$/.test(node)) return nextId(node);
    return node;
  }
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      node[index] = sanitize(node[index], key);
    }
    return node;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'name' && typeof v === 'string' && (node.screen_name !== undefined || node.avatar)) {
      node[k] = nextName(v);
      continue;
    }
    node[k] = sanitize(v, k);
  }
  return node;
}

sanitize(data, '');

// Second pass on the serialized form: identifiers also appear inside URLs,
// mention entities, and cursor values.
let out = JSON.stringify(data);

// Display names must never be replaced globally: a user named "Business"
// must not change verification. Only content fields may contain prose names.
// Media file names on Twitter's image host; the whole path tail is replaced,
// while a `?name=`/`?format=` query survives for the tests that exercise it.
out = out.replace(
  /(pbs\.twimg\.com\/(?:media|tweet_video_thumb|profile_images|profile_banners|ext_tw_video_thumb|amplify_video_thumb)\/)[^"\\?]+/g,
  (whole, dir) => {
    if (!mediaMap.has(whole)) mediaMap.set(whole, `${dir}img${mediaMap.size + 1}.jpg`);
    return mediaMap.get(whole);
  },
);

const clean = JSON.parse(out);
const CONTENT_KEYS = new Set(['full_text', 'text', 'translation', 'description', 'display', 'display_url', 'expanded', 'expanded_url', 'url', 'image_url']);
function replaceContent(value, key) {
  let result = value;
  for (const [oldId, newId] of idMap) result = result.replaceAll(oldId, newId);
  result = result.replace(/\d{15,}/g, (id) => /^1000000000000000\d{3}$/.test(id) ? id : nextId(id));
  for (const [handle, replacement] of screenMap) {
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(@|/|\\b)${escaped}(?![A-Za-z0-9_])`, 'gi'), (_, prefix) => prefix + replacement);
  }
  if (CONTENT_KEYS.has(key)) {
    for (const [name, replacement] of nameMap) result = result.replaceAll(name, replacement);
  }
  return result;
}
function finish(node) {
  if (!node || typeof node !== 'object') return;
  // Entity offsets are code points; replacing handles in prose changes them.
  const textKey = ['full_text', 'text', 'translation'].find((key) => typeof node[key] === 'string');
  const entities = node.entity_set ?? node.entities;
  if (textKey && entities) {
    const chars = Array.from(node[textKey]);
    for (const list of Object.values(entities)) {
      if (!Array.isArray(list)) continue;
      for (const entity of list) {
        if (!Array.isArray(entity.indices)) continue;
        entity.indices = entity.indices.map((index) => Array.from(replaceContent(chars.slice(0, index).join(''), textKey)).length);
      }
    }
    if (Array.isArray(node.display_text_range)) {
      node.display_text_range = node.display_text_range.map((index) => Array.from(replaceContent(chars.slice(0, index).join(''), textKey)).length);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (key === 'id' && /^(?:VXNlcj|VHdlZXQ)/.test(value)) node[key] = 'sanitized-node';
      else if (key === 'value' || key === 'controllerData') node[key] = 'sanitized-cursor';
      else node[key] = replaceContent(value, key);
    } else finish(value);
  }
}
finish(clean);
writeFileSync(outFile, JSON.stringify(clean, null, 2));
console.log(
  `${outFile}: ${idMap.size} ids, ${screenMap.size} handles, ${nameMap.size} names, ${mediaMap.size} media files`,
);
