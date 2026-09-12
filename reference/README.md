# Reference host shim

A minimal **L1 host** for showcard, in plain ES modules: no build step, no
runtime dependencies beyond Node's own built-ins for the parts that genuinely
serve a package over HTTP. It exists to demonstrate that the specification is
implementable on its own, and to give an embedder a working starting point.

Two ways to mount a card, and one thing they share: the injection layer never
touches disk or network on its own — a host puts it into the response bytes
it serves (section 1.1's serve-time injection), and everything here that does
that is on the host side, never inside the card.

- **`mountCard`** — a single complete document, no `assets/` of its own
  (section 6.2's degenerate package). The document goes into an iframe's
  `srcdoc`, injected first. No serving required; this is the mount for a card
  that is nothing but its own `index.html`.
- **`mountPackage`** — a real package, `index.html` plus its own `assets/`
  (section 1.1). The iframe is pointed at a real served URL instead, so the
  package's relative references (`assets/style.css`, and so on) resolve the
  ordinary way a browser resolves any relative reference: against the
  document's own address. Serving the package — the part that makes that URL
  real — is `src/serve.js`'s job, wrapped in an actual `node:http` listener by
  `src/node-serve.js` for the one part of this shim that is Node-only.

## Two-minute embed: a degenerate package

```html
<div id="stage"></div>

<script type="module">
  import { mountCard, createLocalStorageStateStore } from './src/host.js';

  mountCard({
    container: document.getElementById('stage'),
    cardId: 'reading-log-1',            // identity: state is keyed by this,
                                         // held by the host, never written
                                         // into the document (section 1.3)
    cardSource: '<!DOCTYPE html><html><head><title>x</title></head><body>hello</body></html>',
    stateStore: createLocalStorageStateStore(),
    executeBinding: async ({ bindingId, binding, input }) => {
      // Your gateway goes here. Only bindings the card's manifest declares
      // ever reach this function.
      return { ok: 'whatever your tool returned' };
    },
  });
</script>
```

`cardSource` is always a whole document now — `<!DOCTYPE html>`, `<html>`,
`<head>`, `<body>`, all of it (section 1.1). There is no fragment form to
wrap any more; an author writes the same complete document they would write
for any web page.

## Serving a real package

Run `npm run demo` from the repository root for the complete browser/server example.
[`examples/host/server.mjs`](../examples/host/server.mjs) runs in Node;
[`examples/host/browser-host.mjs`](../examples/host/browser-host.mjs) runs in the browser. They use
`createPackageHost` / `injectRuntimeIntoDocument` and `mountPackage` respectively.
The browser never imports the Node listener. See the [integration guide](../guides/host-integration.md)
for the data flow, ownership and production boundaries.

## API

### Card side, injected by the host

| Call | Answer |
|------|--------|
| `card.state.get()` | `{ ok, result: { state } }` |
| `card.state.get(key)` | `{ ok, result: { key, value } }` |
| `card.state.set(key, value)` | `{ ok, result: { state } }` — merges one key |
| `card.state.set(stateObject)` | `{ ok, result: { state } }` — replaces the state |
| `card.invoke(bindingId, input?)` | `{ ok, result }` from the binding |
| `card.emit(name, payload?, to?)` | `{ ok, result: { delivered, to? } }` — accepted for delivery, not a reply; `to` is echoed when the wire carried it; the injection layer attaches `userGesture` on the wire |
| `card.request(capability, payload?)` | the single dispatch point behind all of the above |
| `card.capabilities()` | `{ ok, result: { environment, capabilities } }` |

Every call resolves; none of them ever rejects or throws. A failure is an
envelope: `{ ok: false, code, error, result: {} }`.

### Host side

| Export | From | What it does |
|--------|------|--------------|
| `mountCard(options)` | `src/host.js` | renders a degenerate package (a single document, `srcdoc`) in a sandboxed iframe and opens its socket; returns `{ iframe, dispatch, unmount }` |
| `mountPackage(options)` | `src/host.js` | same, but `src` rather than `srcdoc` — for a package a host is genuinely serving |
| `createMemoryStateStore()` | `src/host.js` | state for the lifetime of the page |
| `createLocalStorageStateStore(storage?)` | `src/host.js` | state that survives a restart |
| `createCapabilityDispatcher(options)` | `src/host.js` | the request handler on its own, without an iframe |
| `readCardManifest(documentSource)` | `src/host.js` | the card's static declaration block |
| `injectRuntimeIntoDocument(documentSource, { csp? })` | `src/wrap.js` | push the runtime (and, on request, a scoped CSP) into a complete entry document |
| `isFullDocument(source)` | `src/wrap.js` | true for text carrying its own document skeleton |
| `CARD_CONTENT_SECURITY_POLICY` | `src/wrap.js` | the default single-document policy `mountCard` injects |
| `createPackageHost({ injectEntry })` | `src/serve.js` | the transport-agnostic package server: `mount`, `unmount`, `handle` |
| `buildInstancePolicy(originPrefix)` | `src/serve.js` | the per-instance, path-scoped CSP a served package gets |
| `startPackageServer({ injectEntry })` | `src/node-serve.js` | wraps `createPackageHost` in a real `node:http` listener (Node-only) |
| `CARD_RUNTIME_SOURCE` | `src/runtime-source.js` | the injection layer as source text, for your own wrapping |
| error code constants | `src/codes.js` | the section 2.6 codes, the two host extension codes, and the wire constants |

`mountCard` options: `container`, `cardSource`, `cardId`, `stateStore`,
`executeBinding`. `mountPackage` options: the same, minus `cardSource`, plus
`entrySource` (the raw, uninjected `index.html` text, for reading the
manifest) and `src` (the served, already-injected entry URL). The hook is
called as `executeBinding({ cardId, bindingId, binding, input })` and may be
async; what it returns becomes the envelope's `result`, and if it throws, the
card receives a failure envelope instead of an exception.

## What this shim implements

Conformance level **L1 (state host)**: package serving with relative
references and Range/ETag, injection layer, the five entry points, envelopes,
per-id persistent state, and the three declarative markers. It also keeps two
host-level promises that sit above L1: a card is rendered in a sandboxed
iframe with no same-origin escape hatch, and a card declaring a newer
contract version still renders while its socket answers
`CARD_HOST_CONTRACT_UNSUPPORTED`.

Both halves of the state budget are enforced: an over-budget write is refused
with `CARD_HOST_STATE_TOO_LARGE` and nothing is truncated.

Opened without a host — double-clicked from disk — a card keeps working:
state falls back to local storage under a key derived from the document's own
location (`location.pathname`), and every binding answers
`CARD_HOST_TOOL_UNAVAILABLE` instead of failing loudly. No identity is ever
burned into a package (section 1.3), so the location is the only thing left
a fallback key could come from — the same partitioning any plain web page
already gets from its own URL.

## What this shim does not implement

- **L2 gateway policy**, including section 3.5's runtime network-permission
  negotiation. Which tools a binding may reach, host allow-lists, transport
  security, card validation, and per-(kind, subject) authorization query and
  memory (section 3.2/4.6) are the embedder's duty. `buildInstancePolicy`
  gives a served package a scoped, default-deny policy
  (`connect-src 'none'` unconditionally — this shim never grants a runtime
  permission it has no negotiation flow for), and the `executeBinding` hook is
  the seam where a real gateway attaches; this shim only guarantees that
  nothing outside the card's manifest ever reaches it.
- **L3 persistence gradient.** Pin/Fork semantics, resident entity identity,
  and authorization-lifecycle management — revocation keyed to a card's
  entity identity, section 3.3 — belong to a host product, not to a shim.
- **Export.** Writing a `*.card.zip` or `*.card.html` with its state snapshot
  burned in (section 6.4) is a host feature this shim does not build for you;
  `injectRuntimeIntoDocument` is the piece it would need.
- **`display.preferredWidthPx`.** The manifest field of section 1.4 is read by
  nobody here. It is advisory — a card's wish about the width it first appears
  at — and both mount functions render into whatever container they are
  handed, so this shim has no width of its own to reconsider. An embedder that
  lays cards out itself reads the field off `readCardManifest` and decides; a
  free-canvas surface is explicitly allowed to ignore it.
- **The sizing regime.** Section 1.7 has a host mark the card document
  `data-card-sizing` when it knows which end decides the height. This shim
  renders one way only, so it marks nothing, and a card sees the unmarked state
  the specification requires it to survive.

## Running it

```
npm ci
npm test          # the shim's own unit and behaviour tests
```

`demo.html` shows a live card with all three markers, a memory state store, and a
stand-in binding, mounted with `mountCard`. Browsers refuse to load ES modules
straight off the disk, so serve this folder over HTTP with any static file
server and open `demo.html` from there; the page says so itself if it was
opened the other way.

`test/serve.test.js` exercises `createPackageHost` directly (routing, ETag,
Range, the per-instance policy) with no server involved; `test/node-serve.test.js`
is the round-trip proof — a real `node:http` server, a real package with a
relative-path asset, and a real browser engine (jsdom, configured to
genuinely fetch subresources) loading it the way a browser would.
