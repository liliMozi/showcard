# showcard

An open specification for interactive cards: a card is a web page.

*[中文](./README.zh.md)*

## Start here

This project contains the specification, reference implementation, authoring
guides and conformance tools.

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
declared time tool and inspect the result. The example serves a card package
with a local stylesheet and persistent browser state.

```sh
npm run check:examples
npm run cli -- validate examples/host/card
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
npm test
```

The reference adapter covers L1. Production authorization (L2),
entity lifetimes and export (L3), and optional extensions require further host
integration and validation. Passing L1 does not certify those features.

See the [CLI documentation](packages/showcard/README.md) for source commands
and adapter usage.

## Repository layout

| Path | What is in it |
|------|---------------|
| `spec/` | The specification in English and Chinese |
| `reference/` | A minimal L1 host shim in plain ES modules |
| `conformance/` | The tests behind chapter 9: static checks on a card file, an L0 harmlessness run, a sugar equivalence matrix for an injection layer, and a probe suite for a host |
| `creator/` | The Recipe Creator: a card skill (chapter 8) that interviews someone and builds a recipe package out of the answers |

## License

- Specification: [CC BY 4.0](LICENSE-SPEC).
- Code: [MIT](LICENSE-CODE).
- Examples and artwork: [Credits & licenses](docs/credits.html).
