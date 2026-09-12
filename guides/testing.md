# Verify your implementation

[中文](testing.zh.md) · [Host integration](host-integration.md)

## Reproduce the project checks

```sh
npm ci
npm test
npm run check:examples
npm run cli -- conformance
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
```

The last command is a complete adapter-factory example, backed by the reference
host in jsdom. It demonstrates package mounting and cleanup; it does not certify
an unrelated Agent. For your implementation, replace that factory with an adapter
that mounts **your host**, then pass its path with `--adapter`.

## Adapter contract

The module's default export is a factory returning an object with
`mount(cardSource, cardId)`. Source is either a complete HTML string or a package
object `{ entry, files }`, where `files` is a Map of package-relative paths to bytes
or text. A mount returns:

| Member | Meaning |
| --- | --- |
| `getDocument()` | The live card document, not the outer host page |
| `remount()` | Reopen the same source under the same entity ID, preserving its store |
| `unmount()` | Tear down that mount and its resources |
| Adapter `close()` (optional) | Close shared servers or browser sessions after the suite |

Use your test framework to obtain the live card document. Do not weaken the
production iframe's sandbox merely to make DOM access convenient for a test.
The test-only `conformance.echo` binding returns `{echo: input}` and must remain
isolated from the production gateway. The [suite contract](../conformance/README.md)
lists its other probe conventions.

## Interpret results accurately

```text
host.l1: pass
host.l2: not-automated
host.l3: not-automated
```

`pass` means the automated assertions ran and passed. `not-automated` means the
suite did not assess those duties; it is neither pass nor fail. Static validation
also does not prove runtime safety or visual correctness.

Before claiming a production host, add tests for permission denial and revocation,
undeclared tool and host requests, per-entity state isolation, source-window
validation, import with no inherited grants, export with current state and assets,
and cleanup when a card closes. Inspect a real browser for layout, keyboard/touch,
audio and the supported host-free behavior. Keep credentials out of fixtures.

Keep `card.state` distinct from optional host-owned data and quiet activity logs.
Do not report extensions available merely to pass capability checks. Re-run tests
when updating your injection layer, dispatcher or package-serving boundary.
