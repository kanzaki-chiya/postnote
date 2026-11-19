// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createZipBuffer, zipDirectory } from '../scripts/zip.mjs';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DEFLATE_METHOD = 8;
const UTF8_NAME_FLAG = 0x0800;

/** CRC-32/ISO-HDLC, written out here so the archive is checked independently of `node:zlib`. */
function referenceCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Parses an archive the way an extractor would: end record, central directory,
 * then each local file header. Every record's CRC-32 is recomputed with
 * `referenceCrc32`, and the data is inflated with `zlib.inflateRawSync`.
 */
function readArchive(buffer) {
  expect(buffer.length).toBeGreaterThanOrEqual(22);

  const endOffset = buffer.length - 22;
  expect(buffer.readUInt32LE(endOffset)).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  expect(buffer.readUInt16LE(endOffset + 4)).toBe(0); // single-disk archive
  expect(buffer.readUInt16LE(endOffset + 6)).toBe(0);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  expect(buffer.readUInt16LE(endOffset + 8)).toBe(entryCount);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  expect(buffer.readUInt16LE(endOffset + 20)).toBe(0); // no archive comment

  const entries = [];
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(
      CENTRAL_DIRECTORY_HEADER_SIGNATURE,
    );
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const time = buffer.readUInt16LE(cursor + 12);
    const date = buffer.readUInt16LE(cursor + 14);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString(
      'utf8',
      cursor + 46,
      cursor + 46 + nameLength,
    );

    expect(buffer.readUInt32LE(localOffset)).toBe(
      LOCAL_FILE_HEADER_SIGNATURE,
    );
    expect(buffer.readUInt16LE(localOffset + 6)).toBe(flags);
    expect(buffer.readUInt16LE(localOffset + 8)).toBe(method);
    expect(buffer.readUInt16LE(localOffset + 10)).toBe(time);
    expect(buffer.readUInt16LE(localOffset + 12)).toBe(date);
    expect(buffer.readUInt32LE(localOffset + 14)).toBe(checksum);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    expect(
      buffer.toString(
        'utf8',
        localOffset + 30,
        localOffset + 30 + localNameLength,
      ),
    ).toBe(name);

    const dataStart =
      localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === DEFLATE_METHOD ? inflateRawSync(compressed) : compressed;

    expect(data.length).toBe(size);
    expect(referenceCrc32(data)).toBe(checksum);

    entries.push({
      name,
      method,
      flags,
      time,
      date,
      checksum,
      size,
      compressedSize,
      data,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  expect(cursor).toBe(centralOffset + centralSize);
  return entries;
}

/**
 * Extracts with the platform's own tool, when one is available: bsdtar on
 * Windows, Info-ZIP's unzip on Linux/macOS. Returns false when no tool exists;
 * a tool that rejects the archive is a test failure, not a skip.
 */
function extractWithSystemTool(zipPath, targetDir) {
  const [command, args] =
    process.platform === 'win32'
      ? ['tar', ['-xf', zipPath, '-C', targetDir]]
      : ['unzip', ['-q', zipPath, '-d', targetDir]];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    if (result.error.code === 'ENOENT') return false;
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} could not extract the archive (exit ${result.status}): ${
        result.stderr || result.stdout
      }`,
    );
  }
  return true;
}

function writeFixture(root, relativePath, content) {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function fixtureBytes() {
  return Buffer.from(Array.from({ length: 256 }, (_, index) => index));
}

let tempRoot;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'postnote-zip-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('createZipBuffer', () => {
  it('writes valid deflate records in a deterministic, name-sorted order', () => {
    const text = Buffer.from('把值得留下的推文，存成一张图。');
    const binary = fixtureBytes();
    const entries = [
      { name: 'b/inner.txt', data: text },
      { name: 'a.txt', data: binary },
      { name: 'empty.bin', data: new Uint8Array(0) },
    ];

    const archive = readArchive(createZipBuffer(entries));

    expect(archive.map((entry) => entry.name)).toEqual([
      'a.txt',
      'b/inner.txt',
      'empty.bin',
    ]);
    for (const entry of archive) {
      expect(entry.method).toBe(DEFLATE_METHOD);
      expect(entry.flags & UTF8_NAME_FLAG).toBe(UTF8_NAME_FLAG);
    }
    expect(archive[0].data.equals(binary)).toBe(true);
    expect(archive[1].data.toString('utf8')).toBe(text.toString('utf8'));
    expect(archive[2].data.length).toBe(0);
  });

  it('produces identical bytes regardless of input order', () => {
    const entries = [
      { name: 'z.txt', data: Buffer.from('z') },
      { name: 'nested/a.txt', data: Buffer.from('a') },
      { name: 'm.json', data: Buffer.from('{"m":1}') },
    ];
    const forward = createZipBuffer(entries);
    const backward = createZipBuffer([...entries].reverse());
    expect(forward.equals(backward)).toBe(true);
  });

  it('writes a valid empty archive', () => {
    const entries = readArchive(createZipBuffer([]));
    expect(entries).toEqual([]);
  });

  it('rejects unsafe names, duplicates and non-byte payloads', () => {
    const data = Buffer.from('x');
    expect(() => createZipBuffer([{ name: '../evil', data }])).toThrow(
      /Unsafe ZIP entry name/,
    );
    expect(() => createZipBuffer([{ name: '/abs', data }])).toThrow(
      /Unsafe ZIP entry name/,
    );
    expect(() =>
      createZipBuffer([
        { name: 'a.txt', data },
        { name: './a.txt', data },
      ]),
    ).toThrow(/Duplicate ZIP entry/);
    expect(() =>
      createZipBuffer([{ name: 'a.txt', data: 'string' }]),
    ).toThrow(/Uint8Array/);
  });
});

describe('zipDirectory', () => {
  it('archives nested directories with the exact original bytes', () => {
    const source = join(tempRoot, 'extension');
    const binary = fixtureBytes();
    const files = {
      'manifest.json': Buffer.from('{"manifest_version":3}\n'),
      'content.js': Buffer.from('console.log("content");\n'),
      'assets/app.css': Buffer.from('.postnote { color: #1d9bf0; }\n'),
      'assets/img/logo.bin': binary,
      '_locales/zh_CN/messages.json': Buffer.from(
        '{"extName":{"message":"推笺 · PostNote"}}\n',
      ),
      'empty.txt': Buffer.alloc(0),
    };
    for (const [relativePath, content] of Object.entries(files)) {
      writeFixture(source, relativePath, content);
    }

    const archivePath = join(tempRoot, 'out', 'postnote.zip');
    const result = zipDirectory(source, archivePath);

    expect(result.file).toBe(archivePath);
    expect(result.bytes).toBe(readFileSync(archivePath).length);
    expect(result.entries).toEqual(
      Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    );

    const archive = readArchive(readFileSync(archivePath));
    expect(archive.map((entry) => entry.name)).toEqual(result.entries);
    for (const entry of archive) {
      expect(entry.name).not.toContain('\\');
      expect(entry.name.startsWith('/')).toBe(false);
      const original = readFileSync(join(source, entry.name));
      expect(entry.data.equals(original)).toBe(true);
    }

    // Independent extractor, when the platform ships one.
    const extracted = join(tempRoot, 'extracted');
    mkdirSync(extracted, { recursive: true });
    if (extractWithSystemTool(archivePath, extracted)) {
      for (const [relativePath, content] of Object.entries(files)) {
        expect(readFileSync(join(extracted, relativePath)).equals(content)).toBe(
          true,
        );
      }
    }
  });

  it('leaves an output archive inside the source tree out of the archive', () => {
    const source = join(tempRoot, 'source');
    writeFixture(source, 'a.txt', 'a');
    const archivePath = join(source, 'bundle.zip');

    zipDirectory(source, archivePath);
    const second = zipDirectory(source, archivePath);

    expect(second.entries).toEqual(['a.txt']);
    expect(readArchive(readFileSync(archivePath))).toHaveLength(1);
  });

  it('creates missing output directories', () => {
    const source = join(tempRoot, 'source');
    writeFixture(source, 'nested/file.txt', 'nested');
    const archivePath = join(tempRoot, 'deeply', 'nested', 'out.zip');

    const result = zipDirectory(source, archivePath);

    expect(result.entries).toEqual(['nested/file.txt']);
    expect(readArchive(readFileSync(archivePath))[0].data.toString()).toBe(
      'nested',
    );
  });
});
