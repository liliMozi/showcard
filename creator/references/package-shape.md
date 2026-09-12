# What the package looks like

A recipe is a standard Agent Skill directory. Nothing in it is a new format;
the only thing that marks it as a recipe is one frontmatter line.

## Directory

```
<recipe-name>/
  SKILL.md
  assets/<something>.card.html      # a template with no assets of its own
  assets/<something>/               # a template that is a full package:
    index.html                      #   its own index.html...
    assets/...                      #   ...and its own assets/
  references/*.md                   # optional, for anything long
```

Zero or more templates, each either shape. A template is a card package in
its own right (section 6.1): most recipes only need the single-file shape —
a card with no `assets/` of its own is a legal, complete package (section
6.2) — and reach for the directory shape only when the template genuinely
carries its own media or a stylesheet worth keeping separate.

Packed, that directory is a zip named `<recipe-name>.recipe`. The `.skill`
extension is the same format under its compatibility name. Exporting or
sharing a minted card (the `.card.zip` exchange of section 6.3) is the
host's job; a recipe author only packs the recipe itself.

## Frontmatter

```yaml
---
name: harbour-tide-table
description: Mint a tide table card for a named harbour. Use when someone asks for tides, a tide chart, or "when is high water at ...".
profile: card-skill
default-enabled: false
---
```

- `name` — kebab-case, the same as the directory name. Do not collide with a
  name the host already ships.
- `description` — this is the trigger, and it is the only part of the package
  that sits in the model's context permanently. Write what the user would say,
  not what the package contains.
- `profile: card-skill` — the one line that makes it a recipe. A host that has
  never heard of the profile ignores an unknown frontmatter key and runs the
  package as an ordinary skill, which is exactly the intent.
- `default-enabled: false` — a recipe an agent installed starts off. The user
  turns it on.

## SKILL.md sections

In this order. Each one exists because something goes wrong without it.

**`# Name`** — then one or two sentences on what this recipe mints and when.

**`## Template`** — the package-relative path to each template file, with the
instruction to read it at mint time. Templates are read when a card is being
cast, never loaded into the resident context: a template is a whole HTML
document, and keeping one in context permanently costs more than the card is
worth.

**`## State`** — the JSON shape the card keeps, as a contract: field names,
types, what each one means. Runtime state has a hard budget of 64 KiB.

**`## Layout and interaction`** — what the card shows, what each control does,
and what must not drift between two cards minted from this recipe.

**`## What the card can do where`** — the three capability answers and the
card's behaviour under each: the channel available, state-only, and no host at
all. This is the stage-4 walkthrough, written down.

**`## Outside a host that understands recipes`** — the closing paragraph. Two
or three sentences saying what this file is on a host with no idea what a
recipe is. Keep it: it is the anti-fragmentation guarantee of section 8.2.
Walk it against the human checklist in section 9.5 of
`conformance/README.md`; that suite does not simulate a skill host.

## Manifest, state, and the runtime

The recipe's State section is the contract. The template realises it with
two static JSON blocks and talks to a host through `window.card`. Block
names, attribute names, and method names are those of the specification:
the manifest block is section 1.4, the state snapshot block is section 1.5,
and the five `window.card` entry points are chapter 2.

**The manifest** — a `<script type="application/json" data-card-manifest>`
block announcing the bindings and domains the card wants to use. A card
that never talks to a host may omit it. The smallest shape that does talk
(section 1.4):

```html
<script type="application/json" data-card-manifest>
{
  "spec": "1.0",
  "toolBindings": {
    "refresh-weather": { "tool": "fetch.request" }
  }
}
</script>
```

**The state snapshot** — a `<script type="application/json" data-card-state>`
block holding the initial or current runtime state. Absence is an empty
object. On first run the injection layer seeds `card.state` from this
block and never writes the node again. A plausible default (section 1.5):

```html
<script type="application/json" data-card-state>
{ "temp": "23°C", "cond": "Cloudy" }
</script>
```

**`stateSchema`** — an optional manifest key (section 1.4). It is a JSON
Schema-style object declaring the expected shape of that snapshot. A host
may check a write against the declaration and refuse a value that does
not match. Declare it when the card persists state the host will remember
across remounts, and keep the schema loose enough that every legitimate
write the card makes still passes. It is a declaration, not a permission:
it does not join the tool digest. A host understands at least `type`,
`properties`, `required`, `enum`, and `items`, and ignores keywords it
does not understand.

**`dataSchema` and host data** — `dataSchema` is a separate optional
host-extension declaration, never a second state channel. A supporting host
may validate its own writes to its host-owned data document against it; it
does not grant the card permission to write data and it does not change
`card.state`. If a recipe benefits from fresh host-supplied facts, teach the
card to feature-detect the documented `data.get` operation, then use
`card.data.get()` only when available. `data` may be a feature descriptor,
not a callable operation. `card.data.onChange(callback)` registers for later
host-pushed replacement documents and returns an unsubscribe function; it does
not invoke the callback immediately. An unsupported or absent capability is
unavailable: keep the burned-in snapshot visible and say plainly that fresh
host data is unavailable rather than inventing a fallback.

**Host extensions** — do not put `track`, host data, or any other host-specific
method into the recipe's portable promise. A host may advertise documented
extension entries with richer values such as `{ status: "available" }`, while
the core `state`, `invoke`, and `emit` entries remain string state words. Read
the extension entry after `card.capabilities()` and use it only when its status
is available. In Hana, `card.track(name, payload?)` is a quiet activity record;
it is neither a binding nor `emit`, and it must not be used as state.

**Language is card state, not protocol** — if a recipe needs a `uiLanguage`
field, define it in the recipe's own State contract. Ask for or choose one
explicit language for the card, and keep a user's existing title, body, and
other content when that field changes. `uiLanguage` is not a manifest field,
capability, or list of languages imposed by this specification.

**`window.card`** — the runtime the injection layer puts on the card's
window (section 2.2). All five entry points are async, return a Promise of
an envelope, and never reject (section 2.3, section 2.4):

- `card.capabilities()` — ask where the card is running.
  `await card.capabilities()`.
- `card.state` — read and write this card's state. `await card.state.get()`
  for the whole object; `await card.state.set(key, value)` for one key.
- `card.invoke(bindingId, input?)` — trigger a binding declared in the
  manifest. `await card.invoke("refresh-weather")`.
- `card.emit(name, payload?, to?)` — report a completed user interaction
  one way. `ok: true` is a delivery receipt, not a reply. `name` matches
  `^[a-z0-9][a-z0-9._-]{0,63}$`; `payload` is optional, JSON-serializable,
  and at most 8192 UTF-8 bytes once serialized. The optional `to` is a
  session id: pass it only when the user has said they want the event
  sent somewhere else. A host that routes emit delivers to the
  conversation the user is speaking to at that moment (embedded card:
  the session that contains it; pinned or popped-out: the focused
  session at the gesture). With no conversation to belong to, the call
  fails with `CARD_HOST_EMIT_NO_ROUTE`.
  `await card.emit("step.done")`.
- `card.request(capability, payload?)` — the general request; the other
  four are named conveniences over it. The five capability names are
  `state.get`, `state.set`, `invoke`, `capabilities`, and `emit`.
  `await card.request("capabilities")`.

## The template file

A template is a legal card whose state is set to defaults — not a fragment,
not a sketch. Specifically:

- It passes the validator with zero findings at error level.
- It carries its own Content-Security-Policy meta in the head, so that opening
  it on its own makes no network request (section 7.8).
- It carries a small placeholder shim, so a blocked resource shows a
  placeholder rather than the browser's dead-image icon.
- Its state is a plausible default, not empty. Someone will open this file
  directly, and an empty template teaches them the card is broken.

A card carrying its own policy is a card that cannot be turned into a tracking
pixel by whoever forwards it. That is the whole reason for the clause, and it
costs one line in the head:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'">
```

Inline script and style have to stay allowed. A card's code is all inline;
a policy that forbids it is a card that kills itself before it renders.

The policy above is written for the single-file shape, where everything the
card needs really is inline or a `data:` payload. A package-shaped template
(its own `assets/`) has no portable way to pre-authorize "my own sibling
files" in a static meta tag — CSP source values name a scheme and a host, not
a bare relative path, and a template does not know in advance where a user
will extract it. Section 7.8 is a SHOULD, not a format requirement either
way: a package-shaped template that skips its own CSP is exactly as legal as
one that carries it, and the conformance suite does not fail a template for
the absence. Serving a package with a real, correctly scoped policy is a
host's job (section 7.1) — see `reference/src/serve.js`'s
`buildInstancePolicy` for what that looks like.
