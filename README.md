# showcard

An open specification for interactive cards: a card is a web page.

*[中文](./README.zh.md)*

## Start here

This is the developer project: the specification, reference implementation,
authoring guides and conformance tools. The marketing website is maintained separately;
the `docs/` tree retains examples and a documentation-site mirror.

| Your goal | Start with |
| --- | --- |
| Make an interactive card | [Card authoring](guides/card-authoring.md) |
| Add Showcard support to your Agent | [Host integration](guides/host-integration.md) |
| Check your implementation | [Testing and adapter guide](guides/testing.md) |
| Teach an Agent a reusable card recipe | [Recipe Creator](creator/README.md) |
| Read the normative contract | [Specification 1.0](spec/1.0.en.md) |

## Run a complete example

Node.js 22.13+ or 24+ is required for development.

```sh
git clone https://github.com/liliMozi/showcard.git
cd showcard
npm ci
npm run demo
```

Open the loopback URL printed by the server. Edit a note and reload it; call the
declared time tool and inspect the result. The example serves a real card package
with a local stylesheet, uses persistent browser state and contains no API key.

```sh
npm run check:examples
npm run cli -- validate examples/host/card
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
npm test
```

The reference and runnable adapter cover L1. Production authorization (L2),
entity lifetimes and export (L3), and optional extensions require further host
integration and validation. Passing L1 does not certify those features.

The source CLI is 0.9.2; the separately published npm package may lag. Use the
commands above for the checked-out version. See [CLI documentation](packages/showcard/README.md).

## Design principles

**One Card.** A card is a web page — a little more than a web page, and just
as easy to write. Its entry point is one complete HTML document; it can carry
any number of asset files, organized exactly like any static website. At its
simplest it is a single file, `my-card.card.html`, that opens with a
double-click in any browser and renders and interacts right there. Hand the
same package to a host that implements this specification and it additionally
gets served with web-server semantics, gains persistent state, negotiated
capabilities, and tool calls bounded by what it declared.

- **One Card.** No SDK, no build step, no lifecycle hooks, no wrapper layer to
  learn. If you can write a web page, you can write a card: the entry is an
  ordinary HTML document, assets are ordinary files under `assets/`,
  references are ordinary relative paths. Everything the card needs travels
  inside the package.
- **The host keeps the power.** The host injects the runtime at the moment it
  serves the card; a card holds only references and the right to ask, while
  credentials and execution stay on the host side. What a card may reach
  through the structured socket is frozen in a static declaration block, and
  trust is graded by authorization — every capability is asked about once, the
  answer is remembered, and it can be revoked at any time, regardless of
  whether the card is pinned. Network access is the one deliberate exception:
  a card can reach out to the web the way any page does, gated by a
  per-instance CSP and a runtime permission query the host never proxies the
  bytes for. Pinning is a different thing: it stamps a card's current state
  into a resident entity.
- **Runnable, not aspirational.** This repository ships a reference host you
  can read in one sitting, and a conformance suite a third party can run
  against their own implementation.

## Repository layout

| Path | What is in it |
|------|---------------|
| `spec/` | The specification itself. `1.0.en.md` is canonical; `1.0.md` is the Chinese edition, maintained alongside it |
| `reference/` | A minimal L1 host shim in plain ES modules — no build step, no runtime dependencies, two files to turn a web page into a legal host |
| `conformance/` | The tests behind chapter 9 as runnable code: static checks on a card file, an L0 harmlessness run, a sugar equivalence matrix for an injection layer, and a probe suite for a host |
| `creator/` | The Recipe Creator: a card skill (chapter 8) that interviews someone and builds a recipe package out of the answers |

## Implementations

- **Reference host shim** — `reference/`, in this repository. Conformance level
  L1 (state host).

Hosting products implementing showcard will be listed here.

## Website

The canonical home is <https://showcard.org>. The source lives at
<https://github.com/liliMozi/showcard>.

## License

Licenses are identified by component:

- The specification text — everything under `spec/` — is licensed under
  [CC BY 4.0](./LICENSE-SPEC).
- The reference host, conformance suite, website demo runtime, and this
  repository's other original code are licensed under the
  [MIT license](./LICENSE-CODE).
- The Recipe sources in `docs/examples/{weather,note,piano,todo}/` are adapted
  from OpenHanako and licensed under Apache-2.0; see
  `docs/examples/LICENSE-RECIPES`. The Great Wall artwork in the note example
  is licensed under CC BY-SA 3.0; see `docs/examples/note/ARTWORK.md`.

## Running the tests

```
npm ci
npm test
```
