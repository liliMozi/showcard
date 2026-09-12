/**
 * Package serving: the HTTP-shaped protocol logic behind section 1.1's
 * "a host serves a card package the way it serves any static site" — plus
 * section 1.2's Range/ETag duty for assets, and the per-instance scoped
 * policy section 7.1 asks for.
 *
 * This module is transport-agnostic on purpose: it never opens a socket or
 * touches the filesystem. It takes a request shape `{ method, pathname,
 * headers }` and returns a response shape `{ status, headers, body }`, so it
 * runs the same whether the thing calling it is a real `node:http` server
 * (see `node-serve.js`), a Worker's `fetch` handler, or a test that calls
 * `handle()` directly with a plain object. A real production host wires this
 * to whatever transport it already runs; nothing here is the transport.
 *
 * URL scheme: `/t/{ticket}/{relativePath}`. The ticket is the scope ticket of
 * section 1.1 — an opaque string a host mints per card instance — and
 * everything after it is resolved against that instance's package root the
 * same way a browser resolves any relative reference: `assets/x.png` from
 * `/t/abc/index.html` is `/t/abc/assets/x.png`, no different from any static
 * site. Cross-instance isolation (section 7.1) falls out of this for free —
 * two mounts of the same package get two tickets, and the scoped policy this
 * module builds names only one of them.
 */

const TICKETED_PATH = /^\/t\/([^/]+)\/(.*)$/;

/** Extension → MIME type, wide enough for what a card package plausibly ships. */
const CONTENT_TYPES = Object.freeze({
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
});

function guessContentType(path) {
  const at = path.lastIndexOf('.');
  const extension = at === -1 ? '' : path.slice(at + 1).toLowerCase();
  return CONTENT_TYPES[extension] || 'application/octet-stream';
}

/** A small, dependency-free string hash (FNV-1a), for a weak ETag. */
function weakETag(bytes) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < bytes.length; at += 1) {
    hash ^= bytes[at];
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(16)}-${bytes.length.toString(16)}"`;
}

function toBytes(content) {
  // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: a binary asset
  // handed in as a Node Buffer can come from a different realm than this
  // module runs in (a Node `Buffer` from `node:fs` versus a jsdom test
  // environment's own `Uint8Array`, for one real case), and `instanceof`
  // across realms is false even for two otherwise-identical typed arrays.
  // `ArrayBuffer.isView` is a duck-type check with no such identity trap.
  if (ArrayBuffer.isView(content)) {
    return content instanceof Uint8Array ? content : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  return new TextEncoder().encode(String(content));
}

/**
 * Parse a single-range `Range: bytes=start-end` header (section 1.2 only
 * asks for the common single-range case a media element actually sends).
 *
 * @returns {{start:number,end:number}|null|undefined} a satisfiable range,
 *          `null` for a range this suite declines to satisfy (416), or
 *          `undefined` when the header is absent or not a `bytes=` range
 *          (served as a plain 200, the same as no header at all).
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) {
    return undefined;
  }
  const [, startText, endText] = match;
  if (startText === '' && endText === '') {
    return null;
  }
  let start;
  let end;
  if (startText === '') {
    // A suffix range: the last N bytes.
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

/**
 * The per-instance Content-Security-Policy (section 7.1: subresources
 * default to this package's own path and scope-ticket prefix, plus `data:`
 * and `blob:`; cross-instance isolation follows because every instance gets
 * its own prefix).
 *
 * This reference host does not implement the runtime network-permission
 * escalation of section 3.5 (an L2 duty; see `conformance/README.md`'s
 * manual-verification list), so `connect-src` stays `'none'` unconditionally
 * rather than growing as permissions are granted — a real host's gateway is
 * where that escalation belongs.
 */
export function buildInstancePolicy(originPrefix) {
  const prefix = String(originPrefix).endsWith('/') ? originPrefix : `${originPrefix}/`;
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' data: ${prefix}`,
    `style-src 'unsafe-inline' data: ${prefix}`,
    `img-src data: blob: ${prefix}`,
    `font-src data: ${prefix}`,
    `media-src data: blob: ${prefix}`,
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * A package host: a registry of mounted instances plus the request handler
 * that serves them. One of these can back any number of real listeners
 * (`node-serve.js` wraps one in an `http.Server`; a test calls `handle`
 * directly).
 */
export function createPackageHost({ injectEntry } = {}) {
  if (typeof injectEntry !== 'function') {
    throw new TypeError('createPackageHost needs injectEntry(entrySource, { csp }) -> string');
  }
  const instances = new Map();

  /**
   * @param {string} ticket the scope ticket (section 1.1); opaque to this module
   * @param {{ files: Map<string, string|Uint8Array>, entry?: string }} pkg
   */
  function mount(ticket, { files, entry = 'index.html' }) {
    if (!(files instanceof Map)) {
      throw new TypeError('mount needs files as a Map<packageRelativePath, content>');
    }
    if (!files.has(entry)) {
      throw new TypeError(`mount needs files to contain the entry ${JSON.stringify(entry)}`);
    }
    instances.set(ticket, { files, entry });
  }

  function unmount(ticket) {
    instances.delete(ticket);
  }

  /**
   * @param {{ method: string, pathname: string, headers?: Record<string,string> }} request
   * @param {{ originPrefixFor?: (ticket: string) => string }} [context] how to
   *        spell this instance's own prefix for the CSP (defaults to the
   *        ticketed path itself, which is all a same-origin server needs)
   * @returns {{ status: number, headers: Record<string,string>, body: string|Uint8Array }}
   */
  function handle(request, context = {}) {
    const { method = 'GET', pathname, headers = {} } = request;
    if (method !== 'GET' && method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET, HEAD' }, body: '' };
    }

    const match = TICKETED_PATH.exec(pathname);
    if (!match) {
      return { status: 404, headers: {}, body: 'not found' };
    }
    const [, ticket, rawRelPath] = match;
    const instance = instances.get(ticket);
    if (!instance) {
      return { status: 404, headers: {}, body: `no card instance for ticket ${JSON.stringify(ticket)}` };
    }

    let relPath;
    try {
      relPath = decodeURIComponent(rawRelPath) || instance.entry;
    } catch (error) {
      return { status: 400, headers: {}, body: 'malformed path' };
    }
    if (relPath.split('/').some((segment) => segment === '..')) {
      return { status: 400, headers: {}, body: 'a package reference may not climb above the package root' };
    }

    const file = instance.files.get(relPath);
    if (file === undefined) {
      return { status: 404, headers: {}, body: `${relPath} is not in this package` };
    }

    if (relPath === instance.entry) {
      const originPrefix = context.originPrefixFor ? context.originPrefixFor(ticket) : `/t/${ticket}/`;
      const entryText = typeof file === 'string' ? file : new TextDecoder().decode(file);
      const injected = injectEntry(entryText, { csp: buildInstancePolicy(originPrefix) });
      const body = method === 'HEAD' ? '' : injected;
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        body,
      };
    }

    return serveAsset(file, relPath, { method, headers });
  }

  function serveAsset(file, relPath, { method, headers }) {
    const bytes = toBytes(file);
    const etag = weakETag(bytes);
    const contentType = guessContentType(relPath);

    if (headers['if-none-match'] === etag) {
      return { status: 304, headers: { etag }, body: '' };
    }

    const range = parseRange(headers.range, bytes.length);
    const baseHeaders = { 'content-type': contentType, etag, 'accept-ranges': 'bytes' };

    if (range === null) {
      return {
        status: 416,
        headers: { ...baseHeaders, 'content-range': `bytes */${bytes.length}` },
        body: '',
      };
    }
    if (range) {
      const { start, end } = range;
      const slice = bytes.subarray(start, end + 1);
      return {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          'content-length': String(slice.length),
        },
        body: method === 'HEAD' ? new Uint8Array(0) : slice,
      };
    }

    return {
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(bytes.length) },
      body: method === 'HEAD' ? new Uint8Array(0) : bytes,
    };
  }

  return { mount, unmount, handle };
}

export { guessContentType, parseRange, weakETag };
