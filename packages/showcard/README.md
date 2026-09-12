# showcard

A command-line tool for the showcard specification — single-file, HTML-first
interactive cards. Three subcommands: check a card file against the static
rules, run the conformance probe suite against a host, and smoke-mount a card
in a headless reference host.

Specification: https://showcard.org

This guide covers CLI **0.9.2**.

> To use this checkout: from the repository root, run `npm ci`, then
> `npm run cli -- --help`.

## Install

```
npm install -g showcard
```

or run it without installing:

```
npx showcard --help
```

## `showcard validate <file-or-dir...>`

Runs the specification's static checks against one or more `*.card.html`
files: the manifest (and its `toolBindings`) is legal JSON of a legal shape,
no relative reference climbs above the package root, no secret pattern is
burned into the file, and the card carries a human-readable title.

A directory containing `index.html` is checked as one package, including all of
its assets. A directory without an entry is a collection: package subdirectories,
`*.card.html` and `*.card.zip` files are discovered recursively. ZIP files are
checked as complete packages. Other files are treated as single-document entries.
Errors inside an asset report that asset's relative path.

```
showcard validate my-card.card.html
showcard validate ./cards/
showcard validate ./weather-card/
showcard validate ./weather.card.zip
```

Exit codes: `0` clean or warnings only, `1` at least one file has an error,
`2` the command itself could not run.

## `showcard conformance [--adapter <module.mjs>]`

Runs the specification's host probe suite: twelve cards, each asking a
judgment about the host purely through the public `window.card` surface,
plus two judgments the driver makes from outside (did the document render,
did the probe script finish). Most are a single `*.card.html` — a
degenerate package with no assets of its own; one is a real multi-file
package, to prove that a relative reference actually resolves against the
served package root.

Without `--adapter`, the probes run against the reference host shim bundled
in this package, headless via jsdom — no host of your own required.

With `--adapter <module.mjs>`, the probes run against your own host instead.
The module's default export must be a **factory function** returning an
adapter object:

```js
// my-adapter.mjs
export default function createMyHostAdapter(options) {
  return {
    async mount(cardSource, cardId) {
      // cardSource is either:
      //   - a string: a single, complete entry document (a degenerate
      //     package's whole index.html); or
      //   - { entry, files }: a real package, files a
      //     Map<packageRelativePath, string> and entry the package-relative
      //     path of its entry (normally "index.html").
      // Mount it in your host however your host serves that shape — a
      // package needs genuine serving (relative references resolve against
      // a real URL) the way a single document does not — keyed by cardId.
      // Everything below may be async.
      return {
        getDocument() {
          // The card's live document (not your host page's document).
        },
        async remount() {
          // Tear the card down and mount the same source under the same
          // cardId again. Used by the state-persistence probe to check that
          // state survives a remount.
        },
        async unmount() {
          // Tear the card down.
        },
      };
    },
  };
}
```

```
showcard conformance
showcard conformance --adapter ./my-adapter.mjs
```

The output is one line per probe card (`pass`/`fail`, and every non-passing
judgment underneath it when a card fails), followed by a level summary in the
specification's `card.l0` / `host.l1` style:

```
host.l1: pass
host.l2: not-automated
host.l3: not-automated
```

L2 (gateway policy) and L3 (persistence gradient / revocation) are host
obligations this suite cannot automate — neither has a hook a card can reach
from inside its own sandbox, which is the point of them — so they always
print `not-automated`, never a pass.

Exit codes: `0` every probe passed, `1` at least one probe failed, `2` the
command itself could not run (a bad `--adapter` path, a module with no
default export, or a default export that does not return a `mount` function).

The adapter may also implement `async close()` to release shared servers or browser
sessions; the CLI awaits it after the suite. See the
[`examples/host/adapter.mjs`](../../examples/host/adapter.mjs).

## `showcard shim <card.html>`

A headless smoke tool, not a browser. Mounts one card in the reference host
(jsdom, no visible page — this is not a page-preview command) and prints what
the mount produced: the manifest's declared contract version, the sandbox
iframe attribute, whether the card rendered visible content, any uncaught
script errors, and the envelope `card.capabilities()` resolves to from inside
the card.

```
showcard shim my-card.card.html
```

Exit codes: `0` the card mounted and ran with no uncaught script error, `1`
an uncaught script error occurred while the card ran, `2` the command itself
could not run (missing file, mount failure).

This does not simulate a user interaction sweep and does not compare
rendering pixel-for-pixel against how the card looked at export time — for
those, run the specification's full L0 harmlessness test and a real browser.

## 关于此工具

`showcard` 是围绕 showcard 规范一致性套件包装的命令行工具：`validate` 跑静态检查，
`conformance` 跑宿主探针套件（默认针对内置参考宿主，也可用 `--adapter` 指向自己的
宿主适配器），`shim` 在无头参考宿主里挂载单张卡片并打印诊断信息。完整规范见
https://showcard.org 。
