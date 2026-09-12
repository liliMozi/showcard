/**
 * A minimal ZIP writer, for test fixtures only.
 *
 * Every entry is stored (method 0, no compression) — the reader in
 * `../../src/zip-read.js` supports both stored and deflate, and a fixture
 * builder has no reason to reach for the more complex of the two. CRC-32 is
 * written as zero throughout: the reader never checks it, matching the reader
 * it exists to exercise.
 */

function utf8(text) {
  return Buffer.from(String(text), 'utf8');
}

/**
 * @param {Record<string, string|Buffer>} entries package-relative path to content
 * @returns {Buffer} a `.card.zip` whose root is the package root (section 6.3)
 */
export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [path, content] of Object.entries(entries)) {
    const nameBytes = utf8(path);
    const dataBytes = Buffer.isBuffer(content) ? content : utf8(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc-32 (unchecked by the reader)
    localHeader.writeUInt32LE(dataBytes.length, 18); // compressed size
    localHeader.writeUInt32LE(dataBytes.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression: stored
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(0, 16); // crc-32
    centralHeader.writeUInt32LE(dataBytes.length, 20); // compressed size
    centralHeader.writeUInt32LE(dataBytes.length, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(Object.keys(entries).length, 8); // entries on this disk
  eocd.writeUInt16LE(Object.keys(entries).length, 10); // total entries
  eocd.writeUInt32LE(centralSection.length, 12); // central directory size
  eocd.writeUInt32LE(localSection.length, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localSection, centralSection, eocd]);
}
