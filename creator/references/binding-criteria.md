# Which actions can be wired to a tool

Read this during stage 3 of the interview, one candidate action at a time.

The question is never "is this action useful". It is "can this action's
arguments be decided at the moment the card is minted". That is the whole
constraint, and it comes from the model of chapter 4: **the wiring is decided
when the card is cast, and the button just runs it.** There is no language
model on the other side of a card's socket. Whatever the button sends was
settled before anyone pressed it.

## The table

| The action's arguments | Verdict | What to do instead |
|---|---|---|
| Fixed values, decided once (a city, a currency, a document id) | **Wire it.** | — |
| Known right now, in this conversation (the file the user just named) | **Wire it.** | Burn the resolved value into the binding at mint time. |
| Typed by the user inside the card | **Wire it, with a declared slot.** | Declare which fields may be substituted; the host substitutes only those. |
| Need a decision at run time ("figure out which report they mean") | **Do not wire it.** | Burn the data in as a snapshot, or move the decision to the user with a control that produces a slot value. |
| Depend on the card's own accumulated state in a way the host cannot see | **Do not wire it.** | Keep the computation inside the card; a card can compute anything it wants without asking anybody. |
| Change something in the world (send, post, pay, delete) | **Wire it — and say so in the interview.** | Tell the user the first press will ask them for authorization. |

## Why the middle rows are refusals rather than difficulties

A card's tool channel carries a declared binding id and a payload. It does not
carry a prompt. So "the model works out the argument when the button is
pressed" describes a mechanism that does not exist — not a hard feature, an
absent one. A recipe written as if it existed produces cards whose buttons
fail in front of their user, which is the failure mode this stage exists to
prevent.

Both escapes are real solutions, not consolation prizes:

- **Burn it in.** If the value would have been decided by looking at
  information available at mint time, decide it at mint time. The card gets a
  snapshot and works everywhere, including with no host at all.
- **Let the user say it.** A field in the card, declared as a slot, is
  strictly better than a model guessing: the person who knows the answer types
  it. Keep the slot list small and named — a slot list that is "anything" is a
  hole, not a feature.

## Read, write, and the question the user gets asked

Chapter 7 of the specification separates the two, and the difference is
visible to the user:

- **Read-class** — no credentials, constrained to declared domains, a light
  ask the first time a new domain comes up.
- **Side-effect class** — always asked before the first use, remembered per
  card afterwards, and never silently repeated.

Neither is a reason to avoid a binding. Both are a reason to mention it during
the interview: a user who was told "the first time you press this, it will ask
you" reads that dialog as the card working, and a user who was not reads it as
the card being suspicious.

## Side-effect binding vs event report

A press that must change the world, or that needs a result back, is a
binding: declare it, wire it, `invoke` it. A press that only needs the
other end of the session to know "the user finished this step" is an
event report: `card.emit(name, payload?, to?)`. The card gets a delivery
receipt and nothing else — no answer, no tool result. A host that routes
emit delivers to the conversation the user is speaking to at that moment:
an embedded card stays in the session that contains it; a pinned or
popped-out card follows the focused session of the window that made the
gesture. When there is no conversation to belong to, the call fails with
`CARD_HOST_EMIT_NO_ROUTE`. Pass `to` only when the user has said they
want the event sent somewhere else.

| What the press is for | Verdict | What to do |
|---|---|---|
| Change something, and the card needs the outcome (refresh, send, compute) | **Wire it.** | `toolBindings` + `invoke`. |
| Tell the session the user completed a step (chose, dismissed, finished) | **Report it.** | `card.emit`. Ask `capabilities()` first; hide or degrade the control when the word is `requires_host`. |

The two are not substitutes. `emit` does not run a tool, and `invoke` is
not a notification channel. If the action needs a result, it is a
binding. If it only needs to be seen, it is an emit.

## Host data and quiet activity are neither

If a host offers them, `card.data.get()` reads a host-owned document and
`card.data.onChange(callback)` registers for later replacement documents; it
does not receive a document when registered. Neither gives a card permission
to write that document. `card.track(name, payload?)` adds a quiet activity
record for the host. They are optional host extensions, not tool bindings, not
`emit`, and not substitutes for card state. Feature-detect the callable
`data.get` operation and `track` before use, and keep the baked-in snapshot
useful when they are unavailable.

## Writing the requirement into the recipe

Intent, not plumbing:

> Refreshing needs a read from the declared weather service for the card's
> city.

Not:

> Call `fetch.request` with `{ hosts: ["api.example-weather.com"] }`.

The first survives being installed on a host whose tools are named differently
and whose gateway takes a different shape. The second is a recipe for one
host, wearing the clothes of a portable one. Section 8.5 is the clause; the
practical test is whether the sentence would still be true on a host you have
never seen.
