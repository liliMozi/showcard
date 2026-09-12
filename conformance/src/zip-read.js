/**
 * A minimal ZIP reader, for `.card.zip` (specification section 6.3).
 *
 * Node-only (it needs `node:zlib`'s raw inflate), and deliberately small: a
 * `.card.zip` is never streamed or written here, only read back into the same
 * `Map<path, Uint8Array>` shape the rest of the checker already works with.
 * Central-directory parsing plus the two compression methods a zip writer
 * actually uses (0 = stored, 8 = deflate) is the whole of what section 6.3
 * asks a reader to understand — nothing here writes a zip, and nothing here
 * needs an npm dependency to read one.
 */

import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

/** A directory entry (trailing `/`) carries no bytes and is not a file. */
function isDirectoryEntry(path) {
  return path.endsWith('/');
}

/**
 * Locate the End Of Central Directory record. It sits at the end of the file,
 * after an optional comment of up to 65535 bytes, so the signature is found by
 * scanning backward rather than assumed to be at a fixed offset.
 */
function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65535 - 22);
  for (let at = buffer.length - 22; at >= minOffset; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return at;
    }
  }
  return -1;
}

/**
 * Read a `.card.zip` into `Map<packageRelativePath, Uint8Array>`.
 *
 * Section 6.3: "the zip's root *is* the package's root" — no outer shell
 * directory is stripped or expected, entries are taken exactly as named.
 *
 * @param {Buffer|Uint8Array} bytes the whole zip file
 * @returns {Map<string, Uint8Array>}
 */
export function readZipPackage(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const eocdAt = findEndOfCentralDirectory(buffer);
  if (eocdAt === -1) {
    throw new Error('not a zip file: no end-of-central-directory record found');
  }

  const totalEntries = buffer.readUInt16LE(eocdAt + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdAt + 16);

  const files = new Map();
  let at = centralDirectoryOffset;

  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error(`corrupt zip: expected a central directory file header at offset ${at}`);
    }
    const compressionMethod = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const fileNameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localHeaderOffset = buffer.readUInt32LE(at + 42);
    const fileName = buffer.toString('utf8', at + 46, at + 46 + fileNameLength);

    if (!isDirectoryEntry(fileName)) {
      files.set(fileName, extractEntry(buffer, localHeaderOffset, compressionMethod, compressedSize));
    }

    at += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function extractEntry(buffer, localHeaderOffset, compressionMethod, compressedSize) {
  if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`corrupt zip: expected a local file header at offset ${localHeaderOffset}`);
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return new Uint8Array(compressed);
  }
  if (compressionMethod === 8) {
    return new Uint8Array(inflateRawSync(compressed));
  }
  throw new Error(`unsupported zip compression method ${compressionMethod}; only stored (0) and deflate (8) are read`);
}
