# Conformance suite

The tests behind chapter 9 of the specification, as code a third party can run
against their own host: static checks on a card package, an L0 harmlessness
run, a sugar equivalence matrix for an injection layer, and a probe suite for
a host.

Nothing here is tied to the reference shim except one file
(`src/reference-adapter.js`). The injection layer arrives as a string and the
host arrives as an adapter, so bringing your own means writing those two things
and nothing else.

## What is in here

| Piece | File | Answers |
|-------|------|---------|
| Static checks | `src/static-checks.js` | section 9.3 — is this card package legal? |
| Command-line checker | `bin/check-card.mjs` | the same, from a shell or a CI job |
| Zip reading | `src/zip-read.js` | reads a `.card.zip` into the files map the checker wants (section 6.3) |
| L0 harmlessness | `src/l0-run.js` | section 9.2 — does the entry behave when opened with no host? |
| Sugar equivalence | `src/sugar-equivalence.js` | section 9.4 — is the sugar really just syntax? |
| Host probes | `src/host-suite.js` + `probes/*` | section 9.6 and the L1 duties of 9.1 |
| Level verdict | `src/levels.js` | section 9.1 — what does all of that add up to? |

## Checking a card from the command line

```
node conformance/bin/check-card.mjs my-card.card.html
node conformance/bin/check-card.mjs my-card-package/
node conformance/bin/check-card.mjs my-card.card.zip
node conformance/bin/check-card.mjs a.card.html b.card.html some-package/
```

A target is any of the three package shapes chapter 6 defines: a directory
holding `index.html` (a card package, section 6.1), a `.card.zip` (the same
package zipped for sharing, section 6.3), or a single file — typically
`*.card.html` — checked as that package's whole `index.html` (the degenerate
package, section 6.2).

Exit code 0 when clean or only warnings, 1 when something is an error, 2 when
the command itself could not run. Warnings do not fail the command: the
natural-language title rule and the declared-width band are SHOULD-level in
the specification, and a checker that fails a build over a SHOULD is a
checker people learn to skip.

The CLI depends on nothing outside `node:*` built-ins — the zip reader in
`src/zip-read.js` uses `node:zlib`'s raw inflate rather than a package. That
is tested, not just intended — it is meant to run in a mint or import path
(section 5.4), and anything it needed installed would be a reason not to run
it.

## The rules it checks

Section 9.3 collapsed the rule set down to a structural minimum: a static
scanner can no longer tell a card "no, you may not write that reference" —
that judgment moved to the runtime CSP and permission model of sections 3.5
and 7.2. What is left is whether the entry can be parsed at all, whether its
manifest (and the `toolBindings` inside it) is legal JSON of a legal shape,
whether a relative reference stays inside the package it travels in, whether
the package leaks a secret, and whether it carries a human title.

| Rule | Level | Section |
|------|-------|---------|
| `entry-missing` | error | 6.1 — the package has no `index.html` |
| `entry-not-a-document` | error | 1.1 — the entry is a complete document, not a fragment |
| `manifest-duplicate` | error | 1.4 — at most one declaration block |
| `manifest-invalid-json` | error | 1.4 — the manifest is valid JSON, and an object |
| `manifest-spec-not-string` | error | 1.4 / 6.7 — `spec` may be absent, but not a number |
| `manifest-display-not-object` | warning | 1.4 — `display` carries preferences, so it is a block |
| `manifest-display-width` | warning | 1.4 / 9.3 — a declared width is a finite number inside the band |
| `manifest-stateschema-not-object` | error | 1.4 — `stateSchema` is a JSON Schema-style object or it is absent |
| `manifest-toolbindings-not-object` | error | 1.4 / 4.2 — `toolBindings` maps a binding id to a binding |
| `manifest-toolbinding-shape` | error | 4.2 — a binding names a `tool`, and its `input`/`description` are the right JSON types |
| `state-duplicate` | error | 1.5 — at most one state snapshot block |
| `state-invalid-json` | error | 1.5 — the state snapshot is valid JSON, and an object |
| `relative-reference-escapes-package` | error | 1.1 / 7.2 — a local reference resolves inside the package, never above its root |
| `secret-pattern` | error | 7.3 — no credential burned into any file the package carries |
| `title-missing` | error | 1.3 — a card has a human-readable title |
| `title-not-natural-language` | warning | 1.3 — and it is not an identifier |

Retired along with the fragment-and-wrapper model this suite used to check:
`forbidden-api` (a script API ban — section 7.2 makes a card's own network
calls a runtime permission question, not a static one), `external-reference` /
`passive-external-reference` (a network-shaped reference is legal to write
now; see `relative-reference-escapes-package` above for the check that
replaced them — the local-reference containment half of the old rule, which
did not go away), `card-id-missing` (no id is ever burned into a package;
section 1.3), and `size-budget` (section 1.2 sets no ceiling — a package is
served like any static site, not inlined into one document).

The scanner reads text rather than a parse tree. An HTML parser is forgiving by
design, and everything it silently drops is exactly what a card author should
have to answer for. The secret scan covers every file in the package,
including comments — a commented-out credential is still in the file.

Findings never quote the secret they matched. A scanner that prints what it
found has moved the secret into the log.

Every finding carries a `file` — the package-relative path it belongs to,
`index.html` for a single checked document — so a finding in a multi-file
package says which file to open.

## The sets it scans against

These come from the specification, not from this suite. They live in
`src/rules.js` as data, so the checker has something to iterate and this README
has something to publish — not invented here.

**Secret patterns** (section 7.3 names these five as starter patterns):

| Name | Shape |
|------|-------|
| `aws-access-key-id` | `AKIA[0-9A-Z]{16}` |
| `openai-style-api-key` | `sk-[A-Za-z0-9]{20,}` |
| `github-personal-access-token` | `ghp_[A-Za-z0-9]{36}` |
| `pem-private-key` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| `bearer-token` | `Bearer [A-Za-z0-9._~+/-]{20,}` |

A floor and not a ceiling: a host validating imports should add the shapes of
its own credentials, and stays conformant by doing so.

**Width band**: 240 to 1200 pixels for `display.preferredWidthPx` (section 1.4),
warning level. A fraction is not a finding: a width is rounded to whole pixels
rather than refused.

**Capability names**: `state.get`, `state.set`, `invoke`, `capabilities`, `emit` —
frozen by section 2.3, which makes them the portable surface a card can name
directly through `request(capability, payload)`. `runSugarEquivalence` still
takes `capabilityNames` so a host that has not finished renaming can run the
matrix against what it has today.

## Suite conventions

Three things the specification leaves open, pinned here so the suite can judge at
all. **All three are suite-defined.**

**Result textification**: how a `data-result` container renders a result.
Section 2.7 says "as text" and stops there. The default is in
`sugar-equivalence.js`; pass `textify` to use your own.

**Echo binding**: probe cards that need a tool channel declare a binding `echo`
with tool `conformance.echo`, and expect the host to hand the input straight
back. An adapter has to wire that up.

**Placeholder marker**: the node a host puts where a blocked passive resource
was (section 7.1) carries the attribute `data-card-placeholder`, and the
resource's alternative text is reachable as that node's text. Section 7.1 leaves
the *shape* of a placeholder to the host on purpose — it belongs to the host's
design system — so the suite pins a marker instead of a look. One attribute is
the whole cost of being judgeable here.

## Running the suite against your own host

Two things to supply.

**Your injection layer, as source text**, for the sugar matrix:

```js
import { runSugarEquivalence } from './conformance/src/sugar-equivalence.js';

const result = await runSugarEquivalence(myInjectionLayerSource);
// { pass, cases: [{ name, pass, detail, sugar, manual }] }
```

For each of the three markers it builds a pair of cards — one written with the
marker, one written by hand with the four entry points — runs both against the
same scripted host, and compares what the host and the DOM observed. It checks
two things, not one: that the pair agree, and that each side actually did
something. A layer implementing neither the marker nor the entry points produces
two identical empty observations, and a matrix that only compared them would
call that a pass.

**An adapter**, for the probe suite:

```js
import { runHostSuite } from './conformance/src/host-suite.js';

const adapter = {
  async mount(cardSource, cardId) {
    // cardSource is either:
    //   - a string: a file-shaped probe's whole entry document, or
    //   - { entry, files }: a dir-shaped probe's package, files a
    //     Map<packageRelativePath, string>
    // Render it in your host, keyed by cardId, however your host serves a
    // package (section 1.1) or a single document.
    return {
      getDocument(),  // the card's live document
      remount(),      // tear it down and mount it again, same identity
      unmount(),
    };
  },
};

const result = await runHostSuite(adapter);
```

Every judgment is asked by a card, from inside the card, through nothing but the
public `window.card` surface; each probe card writes its findings into its own
DOM as `<li data-probe="…" data-verdict="pass|fail">`. A suite that called host
functions directly would be testing one host's API. This one tests what a card
can observe, which is the only thing the specification promises anybody.

The driver adds two judgments per card that a card cannot make about itself:
`document-renders` (the static content is in the DOM, which is what makes the
section 6.7 ban on refusing to open testable) and `probe-completed` (the script
ran to the end, so a host that hangs the socket cannot pass by reporting
nothing).

## The probe cards

Most probes are file-shaped: a single `*.card.html`, which is a legal card in
its own right and is already a degenerate package (section 6.2) — nothing
about the package redefinition asked them to change, and they did not. One
probe is dir-shaped: a real package directory with its own `assets/`, needed
to prove something only a multi-file package can prove.

| Card | Shape | Judges | Section |
|------|-------|--------|---------|
| `envelope-shape` | file | an unknown capability resolves a coded failure envelope, never throws or rejects | 2.4, 9.6 |
| `capabilities-shape` | file | the required fields, and the state words each may take | 3.1 |
| `emit-shape` | file | `window.card.emit` is a function; a legal call resolves an envelope; a call that carries `to` echoes `to` on the receipt; an illegal name resolves `ok: false` without throwing or rejecting; `capabilities().emit` is `available` or `requires_host` | 2.3, 2.4, 3.1 |
| `state-roundtrip` | file | `set(key, value)`, `set(wholeObject)`, `get(key)`, `get()` | 2.3, 2.5 |
| `state-persistence` | file | state survives a remount — two phases, driven by `remount()` | 9.1 (L1) |
| `state-budget` | file | an over-budget write is refused with `CARD_HOST_STATE_TOO_LARGE`, and nothing is truncated | 2.5 |
| `undeclared-binding` | file | a binding the manifest never declared answers `CARD_HOST_TOOL_UNAVAILABLE` | 1.4, 7.4 |
| `contract-unsupported` | file | a card declaring `spec: "9.9"` still renders, and its socket answers `CARD_HOST_CONTRACT_UNSUPPORTED` | 6.7, 9.6 |
| `sugar-invoke` | file | a form's fields reach the binding, with no script of the card's own | 2.7 |
| `sugar-persist` | file | a marked field writes itself into state | 2.7 |
| `sugar-result` | file | a marked container takes the binding's result | 2.7 |
| `passive-placeholder` | file | an external image reference does not load before permission is granted, and a marked placeholder carrying its alt text stands in its place | 1.2, 3.5, 7.1 |
| `package-relative-assets` | dir | a package's own `assets/style.css` and `assets/marker.svg` resolve by ordinary relative reference against the served package root | 1.1, 1.2 |

Each one is a legal card in its own right and clears the static checks at error
level. `passive-placeholder` draws one warning-adjacent expectation by design:
the external image it references is the very thing it is probing, and the
static checker has nothing to say about a network-shaped reference any more
(section 7.2) — the probe is the check that used to be static and is now
runtime.

### What `package-relative-assets` does and does not prove

It proves that a same-package relative reference — a stylesheet and an image,
both under `assets/` — resolves against the package's own served location the
way any static site's relative references resolve, by reading it back from
inside the card through `window.getComputedStyle` (the stylesheet actually
applied) and the resolved `<img>.src` (the image reference resolved to the
right URL, inside the served package).

It does **not** prove that the image's bytes decode into a picture: a bare
`jsdom` install has no image codec (that needs the optional `canvas`
package, which this suite does not depend on), so `naturalWidth` and the
`load` event are not usable signals here. That gap is closed a different way,
not left silent: `reference/test/node-serve.test.js` proves byte-for-byte
delivery of the same kind of asset — content, `ETag`, and a `Range` request —
over a real `node:http` server, which is the layer that question actually
belongs to. A third-party host is free to make its own stronger claim about
end-to-end image loading in a real browser; this suite's probe only claims
what it can verify inside jsdom.

## L0 harmlessness

```js
import { runL0Harmlessness } from './conformance/src/l0-run.js';

const result = await runL0Harmlessness(fileContents);
// { pass, violations: [{ kind, detail }], interactions, environment, storage }
```

The card is loaded standalone — `window.parent === window`, scripts running, no
host listening — every control is clicked and every field changed, and the run
asserts zero network requests, zero uncaught exceptions, zero unhandled
rejections, and that something rendered. If the card writes state, the fallback
storage key has to derive from the document's own location (section 2.5) —
`location.pathname`, the same partitioning any plain web page already gets
from its URL — rather than from its title. No card id is burned into a
package to derive a key from any more (section 1.3), so the location is the
only thing left that could ever name one.

The network channels are replaced with recorders before any card script runs, so
what is caught is the *reach* for the network, not a failed request. A card that
never touches state leaves the storage check unassessed rather than passing it:
inventing a verdict there would be inventing a requirement.

This runner takes a single document — the entry — because that is what a
double-click opens, and everything section 9.2 asserts (no network reach, no
uncaught exception, something renders, state keys off the location) is a
property of the entry's own script behaviour. A package's `assets/` loading
correctly under `file://` when double-clicked for real is native browser
behaviour this runner does not need to simulate: nothing in the injection
layer is involved in resolving those references, the browser's own relative-
URL algorithm is.

Runs cannot overlap. A run takes over the process-level unhandled rejection
listeners for its duration, because a rejection inside the card surfaces there
and nowhere else; anything that is not the card's own rejection is forwarded to
the parked listeners rather than swallowed.

## Levels

```js
determineLevels({ staticResult, l0Result, hostResult });
// { card: { l0 }, host: { l1, l2: 'not-automated', l3: 'not-automated' } }
```

Section 9.1 is two ladders in one table. Hosts are graded L0 to L3; cards are
graded by the L0 harmlessness test of section 9.2, which is a property of a file
rather than of a program. The verdict keeps them apart.

All three inputs are required — there is no partial run, because a missing
result would have to be scored as a pass or a fail and both would be a lie about
work that was never done. Warnings never fail a card.

**L2 and L3 are `not-automated`, never a pass.** L2 needs a host that will
execute a binding under a stated domain policy, run the section 3.5 runtime
network-permission negotiation (CSP interception, a real user gesture
answering the prompt, the answer being remembered), and query and remember
per-(kind, subject) authorization, letting a suite watch it; L3 needs pin/Fork
semantics and authorization-lifecycle management (revocation) driven through a
real user gesture. None of that has a hook a card can reach — which is
precisely the point of it — so a suite claiming to have judged it would be
reporting on nothing. Automating it needs host-side hooks that do not exist
yet.

## Manual verification (what this suite cannot automate)

Named here rather than left for someone to discover the hard way. A
third-party host implementer should check these by hand; none of them are
covered by an automated pass in this suite.

- **The section 3.5 runtime network-permission flow itself** — a card's own
  `fetch`/`<img>`/`<script src>` at a not-yet-permitted host being caught by
  the host's per-instance CSP, the host surfacing a real prompt, the answer
  being remembered at the chosen grain (once / this session / always), and a
  subsequent load actually reaching the network once permitted. `passive-placeholder`
  proves the *default-deny* half (nothing loads before permission is
  granted); the *granting* half needs a host with a real permission UI and a
  human clicking it.
- **CSP enforcement in a real browser.** `jsdom` does not implement a CSP
  engine, so the per-instance policy `reference/src/serve.js` builds
  (`buildInstancePolicy`) is exercised for shape (right directives, right
  scoped prefix, no leakage between two instances of the same package — see
  `reference/test/serve.test.js`) but never for actual browser enforcement.
  Open a served package in a real browser and confirm the policy in
  `document.querySelector('meta[http-equiv="Content-Security-Policy"]')`
  behaves the way the directives say it should.
- **A real `<img>`/`<video>`/`<audio>` decoding a package asset end to end**
  in a browser — see the `package-relative-assets` note above.
- **Range playback of a genuinely large asset** — dragging a scrubber on a
  real `<video>` and confirming the browser issues `206 Partial Content`
  requests rather than downloading the whole file first. `serve.js`'s Range
  handling is proven at the protocol level (`reference/test/serve.test.js`)
  and over a real server (`reference/test/node-serve.test.js`); whether a
  real media element actually *chooses* to send a ranged request is a
  browser behaviour, not something this suite's package server controls.
- **Pixel-identical rendering**, section 9.2's stated method for "renders the
  way it looked at export time" — this suite's renderability check is a
  structural stand-in (see "Known deviations" below).
- **Emit routing to a live conversation** — whether a pinned or popped-out
  card without `to` reaches the focused chat only on a user gesture with the
  chat surface visible, and fails with `CARD_HOST_EMIT_NO_ROUTE` when that
  conversation cannot be determined. This suite cannot see a host's session
  focus or user-activation flags.

## Recipe downgrade (section 9.5)

Section 9.5 asks that a card skill still work as a plain skill in a host that has
never heard of cards, and still produce a legal card package. That is a process-level
test, and this suite does not simulate a skill host. The way to run it:

1. run the recipe in a skill host with no card awareness, by its own instructions;
2. take the package or `*.card.html` it produced;
3. put it through `bin/check-card.mjs` — no errors;
4. put it through `runL0Harmlessness` (on the entry) — passes.

Steps 3 and 4 are the acceptance criteria. Step 1 is yours.

## Known deviations from the letter of chapter 9

- **Section 9.2 asks for a screenshot comparison** of the card against how it
  looked at export time. This suite runs on jsdom so that it runs anywhere, and
  jsdom has no pixels. The renderability check is a structural stand-in and is
  weaker: it establishes that the card rendered, not that it rendered the same.
- **The in-repo adapter bridges one hop**, and the hop differs by probe shape.
  For a file-shaped probe: jsdom will not execute scripts inside an iframe, so
  `reference-adapter.js` mounts the card for real through `mountCard`, then
  opens the prepared document `mountCard` produced in its own window and wires
  that window's `parent.postMessage` straight to the dispatcher `mountCard`
  built. For a dir-shaped probe: there is no document string to open directly
  — a package's relative references only resolve against a real served URL —
  so the adapter actually serves the package (`reference/src/serve.js`,
  wrapped in a real `node:http` listener by `reference/src/node-serve.js`),
  mounts it for real through `mountPackage`, and opens the served URL with
  `JSDOM.fromURL({ resources: 'usable' })`, which fetches the entry and its
  assets over real loopback HTTP the way a browser would. Either way, document
  assembly, manifest reading, the contract-version decision, capability
  dispatch and the state store are all the real code path; only the
  postMessage hop is bridged, and that hop has its own coverage in the shim's
  host tests. A browser-based adapter needs no bridge at all.

## Running it

```
npm test
```

The suite runs against the reference shim in `../reference` as its in-repo
subject: the static checks over the probe cards, the sugar matrix over the shim's
injection layer, and the probe suite over a host built on `mountCard` /
`mountPackage`. Each of the self-proving cases is there on purpose — a bent
injection layer the matrix has to catch, a host that forgets state across a
remount, a host whose answers are not envelopes, a card that never finishes. A
judge that cannot fail anything is not a judge.
