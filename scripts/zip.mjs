/**
 * Minimal PKZIP writer for the extension bundle.
 *
 * Only what the build needs: one DEFLATE-compressed file per entry, no
 * data descriptors, no ZIP64, no encryption. Entries are written in a stable
 * order and with a fixed DOS timestamp, so two builds from the same sources
 * produce byte-identical archives on Windows and Linux.
 *
 * Relies on `node:zlib`'s `crc32` (Node >= 20.15).
 *
 * The format is described in PKWARE's APPNOTE.TXT, sections 4.3.6 (local file
 * header), 4.3.12 (central directory header) and 4.3.16 (end of central
 * directory record).
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** 2.0: the version that introduced DEFLATE. */
const VERSION_NEEDED_TO_EXTRACT = 20;
/** High byte 3 = Unix, so the external mode bits below are meaningful. */
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED_TO_EXTRACT;
/** Bit 11: entry names are UTF-8. */
const UTF8_NAME_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const DEFLATE_LEVEL = 9;
/** 00:00:00 of 1980-01-01, the earliest DOS timestamp: keeps builds repeatable. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
/** `-rw-r--r--`, stored in the central directory's external attributes. */
const FILE_MODE = 0o100644;

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

/**
 * ZIP names always use forward slashes, stay relative and must not try to
 * escape the extraction directory.
 */
function normalizeEntryName(name) {
  if (typeof name !== 'string' || name === '') {
    throw new TypeError('ZIP entry name must be a non-empty string');
  }
  const normalized = name.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const segments = normalized.split('/');
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe ZIP entry name: ${name}`);
  }
  return normalized;
}

function toBuffer(data, name) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError(`ZIP entry "${name}" must carry a Uint8Array`);
  }
  return Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function compareEntryNames(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Validates, normalizes and sorts entries so the archive is deterministic. */
function prepareEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('ZIP entries must be an array');
  }
  const seen = new Set();
  const prepared = entries.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError('ZIP entries must be objects with name and data');
    }
    const name = normalizeEntryName(entry.name);
    if (seen.has(name)) {
      throw new Error(`Duplicate ZIP entry: ${name}`);
    }
    seen.add(name);
    return { name, data: toBuffer(entry.data, name) };
  });
  prepared.sort((a, b) => compareEntryNames(a.name, b.name));
  return prepared;
}

function writeLocalHeader({ nameLength, checksum, compressedSize, size }) {
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT, 4);
  header.writeUInt16LE(UTF8_NAME_FLAG, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameLength, 26);
  header.writeUInt16LE(0, 28); // no extra field
  return header;
}

function writeCentralHeader({
  nameLength,
  checksum,
  compressedSize,
  size,
  localOffset,
}) {
  const header = Buffer.alloc(CENTRAL_HEADER_SIZE);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_MADE_BY, 4);
  header.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT, 6);
  header.writeUInt16LE(UTF8_NAME_FLAG, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameLength, 28);
  header.writeUInt16LE(0, 30); // no extra field
  header.writeUInt16LE(0, 32); // no comment
  header.writeUInt16LE(0, 34); // first disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE((FILE_MODE << 16) >>> 0, 38); // external attributes
  header.writeUInt32LE(localOffset, 42);
  return header;
}

/**
 * Builds a complete ZIP archive in memory.
 *
 * @param {Array<{ name: string; data: Uint8Array }>} entries
 *   File entries only; names may use either separator and are normalized to
 *   forward slashes. Order does not matter, duplicates do.
 * @returns {Buffer}
 */
export function createZipBuffer(entries) {
  const prepared = prepareEntries(entries);
  if (prepared.length > MAX_UINT16) {
    throw new Error('ZIP archives with more than 65535 entries need ZIP64');
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of prepared) {
    if (data.length > MAX_UINT32) {
      throw new Error(`ZIP entry "${name}" is larger than 4 GiB`);
    }
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length > MAX_UINT16) {
      throw new Error(`ZIP entry name is too long: ${name}`);
    }
    const compressed = deflateRawSync(data, { level: DEFLATE_LEVEL });
    const checksum = crc32(data) >>> 0;

    localParts.push(
      writeLocalHeader({
        nameLength: nameBytes.length,
        checksum,
        compressedSize: compressed.length,
        size: data.length,
      }),
      nameBytes,
      compressed,
    );
    centralParts.push(
      writeCentralHeader({
        nameLength: nameBytes.length,
        checksum,
        compressedSize: compressed.length,
        size: data.length,
        localOffset: offset,
      }),
      nameBytes,
    );

    offset += LOCAL_HEADER_SIZE + nameBytes.length + compressed.length;
    if (offset > MAX_UINT32) {
      throw new Error('ZIP archive is larger than 4 GiB; ZIP64 is not supported');
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(END_RECORD_SIZE);
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endRecord.writeUInt16LE(0, 4); // this disk
  endRecord.writeUInt16LE(0, 6); // disk with the central directory
  endRecord.writeUInt16LE(prepared.length, 8); // entries on this disk
  endRecord.writeUInt16LE(prepared.length, 10); // entries in total
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16); // central directory offset
  endRecord.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

/** Collects every regular file below `root` as a sorted list of POSIX names. */
function collectFiles(root, skip) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, dirent.name);
      const name = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        walk(fullPath, name);
      } else if (dirent.isFile() && resolve(fullPath) !== skip) {
        files.push(name);
      }
      // Symlinks and special files are skipped: the extension directory never
      // contains them, and skipping keeps the walk free of cycles.
    }
  };
  walk(root, '');
  return files.sort(compareEntryNames);
}

/**
 * Zips every file below `sourceDir` and writes the archive to `outFile`.
 *
 * Empty directories are not represented; ZIP needs an explicit entry for them
 * and the extension never ships one. A pre-existing `outFile` inside
 * `sourceDir` is left out of the archive.
 *
 * @param {string} sourceDir
 * @param {string} outFile
 * @returns {{ file: string; bytes: number; entries: string[] }}
 */
export function zipDirectory(sourceDir, outFile) {
  const root = resolve(sourceDir);
  const target = resolve(outFile);
  const names = collectFiles(root, target);
  const entries = names.map((name) => ({
    name,
    data: readFileSync(join(root, name)),
  }));
  const buffer = createZipBuffer(entries);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  return { file: target, bytes: buffer.length, entries: names };
}
