# Make your first Showcard

[中文](card-authoring.zh.md) · [Project](../README.md) · [Normative specification](../spec/1.0.en.md)

A card author writes an HTML document and its assets. The host implementer supplies
the runtime, storage and tool gateway. You do not need to implement a host to write a card.

## Start with a working card

Use Node.js 22.13+ or 24+. From the repository root:

```sh
npm ci
npm run demo
```

Open the loopback address printed by the server. Edit the note, leave the field,
reload the host page, and check that the note remains. Press the time button:
the card invokes `demo.time.now` in the host and receives an ISO timestamp.

The authoring files are [examples/host/card/](../examples/host/card/):

```text
card/
  index.html
  assets/style.css
```

Copy the whole directory to make your own card. Use a complete HTML entry, a
human-readable `<title>`, relative asset paths, and no credentials. The package
does not assign its own entity ID; the receiving host assigns identity.

## Choose the right mechanism

| Need | Use |
| --- | --- |
| Remember an input | `data-persist="note"`, or `card.state.set("note", value)` |
| Read saved state | `await card.state.get()`; read `result.state` after checking `ok` |
| Call a host tool | Declare a binding in `data-card-manifest`, then `card.invoke(bindingId, input)` |
| Wire a button without JavaScript | `data-invoke="bindingId"` and an output with `data-result="bindingId"` |
| Notify a conversation | Negotiate `emit` first; a successful receipt does not contain an Agent reply |
| Use a host-specific feature | Check both its documented capability and method; keep a useful unavailable state |

Tool names such as `demo.time.now` are supplied by a host. The specification does
not promise that another host implements that name. Decide what the card displays
when a binding is unavailable. A capability being present does not replace permission.

## Validate what you ship

```sh
node conformance/bin/check-card.mjs examples/host/card
npm run cli -- validate examples/host/card
npm test
```

Both current source commands accept an entry file, a package directory or a
`.card.zip`. The packaged CLI additionally discovers cards inside collection
directories. Exit 0 means no errors (warnings may remain); 1 means invalid card
content; 2 means the command could not inspect its target.

## Open and share

A source package is HTML that a browser can render; `data-persist` and the `card`
API need a host runtime. A host's exported package also carries the standard shim,
snapshot and resource placeholders, which provide standalone behavior. Renaming an
uninjected source to `.card.html` does not install the runtime.

For a directory package, zip its contents with `index.html` at the archive root,
not one directory deeper. Keep relative assets and their licenses. Export current
state through the host before sharing; the recipient imports a new independent
entity with no inherited grants. Do not promise that a closed card continues running.

Keep reusable authoring instructions in a [Recipe / Skill](../creator/README.md).
