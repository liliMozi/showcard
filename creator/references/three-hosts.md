# The three-host walkthrough

Run this in stage 4, with the user, before writing any markup. Every answer
becomes a line of the card's behaviour, so a walkthrough that gets skipped
turns into decisions invented at the keyboard.

The ladder is section 9.1 of the specification. What follows is how to ask
about it in words a user can answer.

## A full host

Everything works: state is kept, tools can be called, the card can be pinned
and exported.

Ask: **what does this card do when it is working perfectly?** This is the easy
one, and it is where most people start anyway. Write it down as the baseline
that the other two answers degrade from.

## A state-only host

The card can remember what the user does, but there is no tool channel — every
`invoke` comes back as a coded refusal.

Ask: **when the card cannot fetch, what should it show?** Usually the right
answer is: the last value it had, plus one quiet line admitting it is the last
value. What is almost never right is showing nothing, or showing a value that
looks fresh.

Then ask: **what should the buttons do?** A control that needs the host asks
`window.card.capabilities()` when the card loads and disables itself if the
answer says the channel is unavailable. A button that invites a press the host
will refuse is worse than a button that is plainly unavailable. The same
walk applies to `emit`: with no host, `capabilities()` reports
`emit: "requires_host"` and a call resolves as a failure envelope, so the
card hides or degrades the interaction that would report the event.

Host-specific controls follow the same rule. First inspect the documented
extension entry after `card.capabilities()`. Hana's entries may be objects such
as `{ status: "available" }`, unlike the portable core strings. Check the
callable `data.get` operation, not a `data` feature descriptor. When `data.get`
or `track` is absent or not available, keep the snapshot readable and make the
control explicitly unavailable; do not call an invented fallback. `data` is a
host-owned document that the card reads, while `track` is a quiet activity
record rather than a tool binding or state write.

## A bare browser

Someone double-clicked the file. There is no host at all. State falls back to
the browser's own storage, tool calls return a structured refusal, and
nothing reaches the network.

Ask: **is this file still worth opening?** If the honest answer is no, the
card is minting empty and the fix is at stage 2 — burn in a real snapshot.

Three things to confirm concretely:

1. **Content.** The snapshot burned in at mint time is the whole content, and
   it renders.
2. **Controls.** Every control can be clicked without throwing. Failing
   politely is the requirement; succeeding is not.
3. **Blocked resources.** Anything referenced by URL shows a placeholder
   rather than the browser's broken-image icon. In a card the host generated,
   the placeholder shim in the card's own head is what does this — which is
   why the template carries one (section 7.8).

## The checklist

Copy this into the recipe's SKILL.md as the capability section, filled in:

- [ ] Full host — what works, and what the card shows.
- [ ] State-only host — what is shown instead of fresh data, in what words,
      and which controls disable themselves.
- [ ] Bare browser — what the burned-in snapshot contains, and that every
      control fails quietly.
- [ ] Blocked resources — where placeholders can appear, and whether the
      layout survives them.
- [ ] The card was actually opened by double-clicking it, not reasoned about.
