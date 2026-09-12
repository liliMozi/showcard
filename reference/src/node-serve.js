/**
 * A `node:http` listener around `serve.js`'s transport-agnostic package host.
 *
 * `serve.js` itself never opens a socket (so it can be tested, and reused,
 * without one); this is the one file in the reference implementation that
 * actually does, for the two places a *real* server earns its keep: the
 * round-trip proof in `reference/test/serve.test.js`, and a demo script.
 * Node-only on purpose — a real production host wires `createPackageHost`'s
 * `handle` into whatever transport it already runs (Node, a Worker, anything
 * with a request/response shape), and this file is one example of that, not
 * the only correct one.
 */

import { createServer } from 'node:http';

import { createPackageHost } from './serve.js';

/**
 * @param {{ injectEntry: Function }} options same as `createPackageHost`
 * @returns {Promise<{ packageHost: object, url: (ticket, relPath?) => string, close: () => Promise<void> }>}
 *          `url` builds the address for a mounted instance, relative to
 *          whatever loopback port this server actually bound.
 */
export async function startPackageServer({ injectEntry }) {
  const packageHost = createPackageHost({ injectEntry });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://internal.invalid');
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }

    const response = packageHost.handle(
      { method: req.method, pathname: url.pathname, headers },
      { originPrefixFor: (ticket) => `${origin()}/t/${ticket}/` },
    );

    res.writeHead(response.status, response.headers);
    res.end(typeof response.body === 'string' ? response.body : Buffer.from(response.body));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  function origin() {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
  }

  return {
    packageHost,
    url(ticket, relPath = '') {
      return `${origin()}/t/${ticket}/${relPath}`;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
