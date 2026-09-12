# Add Showcard to your Agent

[中文](host-integration.zh.md) · [Project](../README.md) · [Testing your host](testing.md)

Start with the example, then replace its integration points with your
own application's services. The reference is an L1 implementation, not a complete
Agent, plugin system, permission service, or production backend.

## Run the integration

```sh
npm ci
npm run demo
```

The example binds to `127.0.0.1:8787`. Use `npm run demo -- --port 8788` if needed.
Stop it with Ctrl+C. The server serves only its explicitly selected files and one
mounted card package. It is not an arbitrary file server or outbound proxy.

| File | Runs in | Responsibility |
| --- | --- | --- |
| `examples/host/server.mjs` | Node | Serve the host page, browser modules, bootstrap data and ticketed card assets |
| `examples/host/browser-host.mjs` | Browser, host frame | Load the package, bind its identity and state store, attach the example tool |
| `examples/host/card/index.html` | Sandboxed card iframe | Present and edit data; request the declared tool |
| `reference/src/host.js` | Browser | Dispatch requests and return structured envelopes |
| `reference/src/serve.js` | Server integration | Serve a package with its own relative resources and scoped policy |

The example stores state in the host browser's local storage under a stable card
ID. Storage belongs to that browser and origin; changing the demo port changes the
origin. A product host can provide the same `get(cardId)` / `set(cardId, state)`
interface over its own database. A remount uses the same entity ID; importing a
shared package creates a fresh one.

## Follow the data flow

1. Validate the package at the import/mint boundary and assign an entity ID.
2. Serve its entry and assets inside an instance-specific URL space. Inject the
   runtime before author scripts, using the scoped CSP from the package server.
3. Seed host state explicitly from the snapshot only when the entity has no saved
   state. Do not replace a user's saved state every time the iframe mounts.
4. Mount a sandboxed iframe and accept requests only from that instance's window.
   Echo `requestId`; return `{ok, result}` or `{ok:false, code, error, result}`.
5. Resolve a binding against the static manifest, enforce host authorization, then
   execute it. Do not interpret card-supplied tool names as arbitrary backend calls.
6. Persist state against entity identity. On unmount, remove listeners and active
   subscriptions; retain or remove data according to the entity's lifetime.

The example's only tool is the explicitly allowed, side-effect-free
`demo.time.now`. Its browser callback demonstrates the tool boundary with an
ISO timestamp. Tools holding credentials or modifying files belong behind a
trusted backend gateway; credentials **MUST NOT** enter card or browser code.

## What the reference gives you, and what you must supply

| Area | Reference / example | Product integration responsibility |
| --- | --- | --- |
| Rendering and assets | Sandboxed mounts; ticketed package paths; Range/ETag | Your layout, sizing marks, theme, loading/error UI and instance teardown |
| State | Per-ID store interface; memory and local-storage stores; 64 KiB budget | Your durable store, ownership, recovery and explicit initialization |
| Tool requests | Manifest binding lookup and `executeBinding` hook | Trusted tool registry, input checks, user grants, refusal and revocation |
| Direct network access | Default-deny scoped CSP | Runtime permission UI and per-instance host grants; no arbitrary proxy |
| Conversation events | Core wire shape and acceptance receipt | Actual session routing, user intent and failures when no route exists |
| Import/export | Package serving and runtime injection building blocks | Snapshot export, ZIP creation, portable assets, new import identity and reset grants |
| Pinning and lifetime | Described by the specification | Durable entity creation/forking, independent instances and cleanup |
| Optional host data / activity | Documented extensions | Implement only if advertised; other hosts must remain usable |

The reference dispatcher acknowledges `emit` shapes for conformance; it does not
deliver messages to an Agent conversation. A real host must connect delivery before
advertising that behavior, or explicitly report it unavailable.

## Permission and lifecycle boundaries

Credentials stay on the host. Tool declarations constrain what a card may request;
they do not grant authority. Keep grants scoped to the entity and declared subjects,
revoke them when required by the declaration epoch, and reset trust on import.
Pinning does not bypass authorization. A saved card can survive a conversation,
but an unrendered card executes nothing. Scheduling/background work, if supported,
is a separate host capability and must not be inferred from persistence.

Use [the conformance guide](testing.md) to check observable protocol behavior.
L2 authorization and L3 lifetime/export duties also need host-side tests and manual
review; a green L1 result is not a blanket production-security certification.
