import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createPackageHost } from '../../reference/src/serve.js';
import { injectRuntimeIntoDocument } from '../../reference/src/wrap.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TICKET = 'development-note';
const CARD_ID = 'development-note-card';

const FILES = Object.freeze({
  entry: join(HERE, 'card', 'index.html'),
  stylesheet: join(HERE, 'card', 'assets', 'style.css'),
  browserHost: join(HERE, 'browser-host.mjs'),
  gateway: join(HERE, 'gateway.js'),
  referenceHost: join(HERE, '..', '..', 'reference', 'src', 'host.js'),
  referenceCodes: join(HERE, '..', '..', 'reference', 'src', 'codes.js'),
  referenceWrap: join(HERE, '..', '..', 'reference', 'src', 'wrap.js'),
  referenceRuntime: join(HERE, '..', '..', 'reference', 'src', 'runtime-source.js'),
  referencePlaceholder: join(HERE, '..', '..', 'reference', 'src', 'placeholder-source.js'),
});

const MIME_TYPES = Object.freeze({
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  css: 'text/css; charset=utf-8',
});

function contentType(pathname) {
  const extension = pathname.slice(pathname.lastIndexOf('.') + 1);
  return MIME_TYPES[extension] || 'application/octet-stream';
}

function send(response, { status, headers = {}, body = '' }, method) {
  response.writeHead(status, headers);
  response.end(method === 'HEAD' ? '' : body);
}

function page() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>showcard development host</title>
<style>body{margin:0;background:#f5f0e8;color:#2d2924;font:16px/1.5 Georgia,serif}main{max-width:760px;margin:0 auto;padding:34px 20px}h1{font-weight:500}p{color:#655d54}iframe{display:block;width:100%;height:440px;border:1px solid #dfd7cb;border-radius:10px;background:#fcfaf5}</style></head>
<body><main><h1>showcard development host</h1><p>This loopback example serves one fixed card package. Its note persists in this browser; its only enabled binding returns the current time.</p><p data-host-error role="alert"></p><div data-card-host></div></main><script type="module" src="/browser-host.mjs"></script></body>
</html>`;
}

async function loadFixture() {
  let loaded;
  try {
    loaded = await Promise.all([
      readFile(FILES.entry, 'utf8'),
      readFile(FILES.stylesheet, 'utf8'),
      readFile(FILES.browserHost, 'utf8'),
      readFile(FILES.gateway, 'utf8'),
      readFile(FILES.referenceHost, 'utf8'),
      readFile(FILES.referenceCodes, 'utf8'),
      readFile(FILES.referenceWrap, 'utf8'),
      readFile(FILES.referenceRuntime, 'utf8'),
      readFile(FILES.referencePlaceholder, 'utf8'),
    ]);
  } catch {
    throw new Error('The development host could not load its fixed example files.');
  }
  const [entry, stylesheet, browserHost, gateway, referenceHost, referenceCodes, referenceWrap, referenceRuntime, referencePlaceholder] = loaded;
  return {
    entry,
    initialState: parseInitialState(entry),
    packageFiles: new Map([['index.html', entry], ['assets/style.css', stylesheet]]),
    staticFiles: new Map([
      ['/browser-host.mjs', browserHost],
      ['/gateway.js', gateway],
      ['/reference/host.js', referenceHost],
      ['/reference/codes.js', referenceCodes],
      ['/reference/wrap.js', referenceWrap],
      ['/reference/runtime-source.js', referenceRuntime],
      ['/reference/placeholder-source.js', referencePlaceholder],
    ]),
  };
}

/** Parse the fixed fixture's optional state snapshot before the listener opens. */
export function parseInitialState(entry) {
  const match = /<script\b(?=[^>]*\bdata-card-state\b)(?=[^>]*\btype=(['"])application\/json\1)[^>]*>([\s\S]*?)<\/script\s*>/i.exec(entry);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[2]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The development card state snapshot must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The development card state snapshot is not valid JSON.');
    }
    throw error;
  }
}

function validPort(port) {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

/** Start one fixed loopback development host. No request ever maps to disk. */
export async function startDemoServer({ port = 8787 } = {}) {
  if (!validPort(port)) {
    throw new TypeError('The demo port must be an integer from 0 through 65535.');
  }
  const fixture = await loadFixture();
  const packageHost = createPackageHost({ injectEntry: injectRuntimeIntoDocument });
  packageHost.mount(TICKET, { files: fixture.packageFiles });

  let server;
  const origin = () => {
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
  };
  server = createServer((request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', 'http://loopback.invalid');
    if (method !== 'GET' && method !== 'HEAD') {
      send(response, { status: 405, headers: { allow: 'GET, HEAD' }, body: 'method not allowed' }, method);
      return;
    }
    if (url.pathname.startsWith('/t/')) {
      const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value || '']));
      const result = packageHost.handle(
        { method, pathname: url.pathname, headers },
        { originPrefixFor: (ticket) => `${origin()}/t/${ticket}/` },
      );
      send(response, result, method);
      return;
    }
    if (url.pathname === '/') {
      send(response, { status: 200, headers: { 'content-type': MIME_TYPES.html, 'cache-control': 'no-store' }, body: page() }, method);
      return;
    }
    if (url.pathname === '/bootstrap.json') {
      const body = JSON.stringify({
        cardId: CARD_ID,
        cardUrl: `/t/${TICKET}/index.html`,
        entrySource: fixture.entry,
        initialState: fixture.initialState,
      });
      send(response, { status: 200, headers: { 'content-type': MIME_TYPES.json, 'cache-control': 'no-store' }, body }, method);
      return;
    }
    const source = fixture.staticFiles.get(url.pathname);
    if (source !== undefined) {
      send(response, { status: 200, headers: { 'content-type': contentType(url.pathname), 'cache-control': 'no-store' }, body: source }, method);
      return;
    }
    send(response, { status: 404, headers: {}, body: 'not found' }, method);
  });

  await new Promise((resolve, reject) => {
    const fail = (error) => reject(new Error(`The development host could not listen on 127.0.0.1:${port}: ${error.message}`));
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      resolve();
    });
  });

  return {
    packageHost,
    ticket: TICKET,
    origin: origin(),
    url(path = '/') {
      return new URL(path, origin()).href;
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function parsePort(args) {
  if (args.length === 0) return 8787;
  const value = args[0] === '--port' ? args[1] : args[0].startsWith('--port=') ? args[0].slice('--port='.length) : null;
  if (value === null || args.length !== (args[0] === '--port' ? 2 : 1) || !/^\d+$/.test(value)) {
    throw new Error('Usage: node examples/host/server.mjs [--port <0-65535>]');
  }
  const port = Number(value);
  if (!validPort(port)) throw new Error('The demo port must be an integer from 0 through 65535.');
  return port;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let demo;
  try {
    demo = await startDemoServer({ port: parsePort(process.argv.slice(2)) });
    process.stdout.write(`showcard development host: ${demo.url()}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  if (demo) {
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await demo.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
