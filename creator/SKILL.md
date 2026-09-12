---
name: recipe-creator
description: "Turn a kind of card someone keeps asking for into a reusable recipe package — interview them, decide what can be wired to a tool, and build a standard `.recipe` bundle. Use when they say \"make this a recipe\", \"save this so we can use it again\", \"I'll want this kind of card again\", or ask how to package a card. Offer it yourself the second time the same person asks for the same kind of card — the second time is the signal."
profile: card-skill
default-enabled: false
---

# Recipe Creator

A recipe is a skill that teaches you to mint one kind of card. It is an
ordinary Agent Skill with `profile: card-skill` in its frontmatter, so a host
that has never heard of cards still runs it as a skill, and a host that
understands recipes uses it to cast cards. See chapter 8 of the showcard
specification for the profile itself.

Your job in this skill is not to write a card. It is to sit with someone,
find out what they actually keep needing, and leave behind a package that
mints that thing correctly every time — including on hosts that can do less
than yours.

## The second time is the signal

Nobody asks for a recipe. They ask for a card, and then a week later they ask
for almost the same card again. That repetition is the whole trigger: when you
notice you are about to build something you already built, say so and offer to
make it a recipe. Waiting to be asked means it never happens.

The opposite is just as important. A card someone will look at once does not
deserve a package, and talking them out of it is a better outcome than
building it. Recipes cost attention: every installed recipe puts a line in the
model's context forever. One that mints nothing is a tax with no return.

## Stage 0 — start from what is already on the table

The most common entry is not a blank page. It is "turn this card into a
recipe", with the card right there in the conversation. When that is the
situation, read the answers off the card instead of asking for them: what it
shows, what its controls do, what it stores, what it fetches. Then ask only
about the gaps and the choices the card made implicitly.

Interviewing someone about a thing you can both see is a way of proving you
were not paying attention. Ask about the parts that are genuinely undecided —
what should vary between two cards minted from this recipe, and what should
always look the same.

## Stage 1 — the two questions at the door

Ask both before designing anything.

**Will this come back?** If they cannot name a second occasion, stop and say
why: a one-off card is faster to mint directly than to package. Offer to save
the card as a file instead — that is what export is for.

**Does it deserve to be a card at all?** A card earns its place when it has
visible state or something to operate. If the whole answer fits in a sentence,
a sentence is the better answer, and a card around it is decoration. Say that
plainly; being told "you don't need this" is worth more than a package nobody
opens.

## Stage 2 — what the card is

Four questions, in this order.

**What does it show?** The content that is on the card when it opens, before
anyone touches it.

**What can be operated?** Every button, field and checkbox, and — this is the
part people skip — what each one *changes*. A control that changes nothing
observable is a control that will confuse its user.

**Where does the data come from?** Three answers, and they are not
interchangeable:

- Real media — a picture, a track, a clip — goes into the package's own
  `assets/` and is referenced by an ordinary relative path
  (`<img src="assets/cat.png">`). There is no size ceiling (section 1.2): a
  host serves it the way it serves any static file. Inlining a picture as a
  `data:` URI is legal only for something genuinely tiny and decorative — a
  small icon — and is a named anti-pattern for anything bigger: it makes the
  browser parse the whole document into memory before it can show one frame,
  work that belongs to a web server, not to an HTML file. Reach for `assets/`
  by default; reach for a `data:` URI only when the file has no `assets/` of
  its own to put a picture in (a single-file degenerate package, section 6.2)
  and the picture is small enough that inlining it is not the anti-pattern.
- Anything that has to stay fresh comes at run time through a read-class
  binding under a declared domain (chapter 4 of the specification).
- A URL written straight onto an `<img>`, `<video>`, `<audio>` or a CSS
  background pointing at some other host is legal to write, but will not
  load until a host's runtime permission flow grants it (section 3.5) —
  before that, hosts show a placeholder in its place. Use it only where a
  placeholder, or a later permission grant, is an acceptable outcome.

Whatever the source, **the mint always burns in a real snapshot**. A card that
renders empty until a fetch succeeds is a card that is broken everywhere the
fetch cannot happen — which includes the browser someone opens it in three
months from now.

**What is worth remembering?** Which of the user's actions should survive
being closed and reopened. Runtime state has a hard budget of 64 KiB; if the
honest answer is bigger than that, it is not state, it is a document.

## Stage 3 — which actions can be wired

This is the stage that separates a recipe that works from one that fails in
front of its user, so take it one candidate action at a time. The full
criteria table is in `references/binding-criteria.md`; the short form:

- **Every argument is known when the card is minted** — a fixed value, or
  something you already have in front of you. Wire it.
- **An argument needs judgement at run time** — something the model would have
  to decide when the button is pressed. Do not wire it. There is no model in a
  card's tool channel; the binding is decided at mint time and the button just
  runs it. Either burn the data in instead, or let the user type the value
  into the card and pass it through as a declared slot.
- **The action changes something in the world** — say so during the
  interview. The user will be asked to authorize it the first time, and being
  surprised by that question is a bad first impression of the card.

Write the requirement into the recipe **as intent, not as plumbing**: "refresh
needs a read from the declared weather service", not a host's tool name and
argument schema. Section 8.5 of the specification puts it plainly — a recipe
states what it needs and the mint does the wiring. A recipe that names one
host's tools is a recipe that only works on that host.

## Stage 4 — the three hosts

A card outlives the place it was minted, so walk the user through all three
before you build. Details and the checklist are in
`references/three-hosts.md`.

- **A full host** — everything works.
- **A state-only host** — it can remember, but it cannot fetch. What does the
  card show then? "The last value, and a quiet line saying it is the last
  value" is usually the right answer.
- **A bare browser** — someone double-clicked the file. The burned-in snapshot
  is the whole content, controls that need a host are disabled rather than
  broken, and blocked resources show a placeholder.

The answers to these three questions *are* the card's degradation behaviour.
Ask them here and you will not have to invent them while writing markup.

Host extensions are an extra question, never a fourth rung of the ladder. A
recipe uses a documented operation only after `card.capabilities()` says that
operation is available; an absent extension means unavailable, so the
burned-in snapshot stays useful without an invented fallback. If the recipe
needs a `uiLanguage` field, define it as the card's own state: choose or ask
for one explicit language, and preserve the user's existing content when it
changes. It is not a manifest field or a capability.

## What you build

The package shape, the frontmatter and the SKILL.md section template are in
`references/package-shape.md`. Two things are worth stating here because they
are the ones most often got wrong:

**The template is a legal card in its own right.** State set to defaults, and
it passes validation at error level. It carries its own Content-Security-Policy
meta and a small placeholder shim (section 7.8), so that opening the template
file on its own leaks nothing and shows nothing broken.

**The package ends with the degradation paragraph.** Every recipe closes with
a short section saying what the file is on a host that does not know what a
recipe is. That paragraph is the anti-fragmentation guarantee of section 8.2,
and a person walks it against the human checklist in section 9.5 of
`conformance/README.md`; that suite does not simulate a skill host.

## Prove it before you hand it over

Four checks, and the second one is the one that changes minds.

1. **The mechanical gate.** Every template goes through the validator
   (`showcard validate <file>`, or the host's own). Zero findings at error
   level. Warnings are read, not ignored — a size warning means the card is
   about to be too big to send.

2. **Mint it both ways.** Take one real request and mint two cards: one
   through the new recipe, one without it. Put them side by side for the user.
   If the recipe's card is not visibly better, the recipe is not finished, and
   showing that is more honest than asserting the opposite.

3. **Open the template file.** Double-click it. That is what the person who
   receives this card will do. If the placeholder is missing, if a control
   throws instead of failing quietly, if the card is blank — fix it now.

4. **Install it and mint once for real.** Then check that the description
   actually fires: say the thing a user would say, and see whether the recipe
   comes to mind. A recipe nobody triggers has the same value as no recipe.

Then iterate the way any writing is iterated: change what the feedback points
at, explain why the change is what it is, and stop when the user has nothing
left to add. Do not keep polishing past the point where they are satisfied.

## Handing it over

Pack the directory as a `.recipe` bundle (a zip; `.skill` is the same format
under the other name) and install it through the host's installation channel.
Recipes an agent installs on its own arrive **disabled** — the user turns it
on. That is not a formality: an installed recipe changes what the model
suggests, and the person whose agent it is decides that.

If the host has no installation channel, hand over the directory and say where
it goes. The package is a standard skill; there is nothing host-specific about
its contents.

## How to talk about this

Match the words to the person. "Binding", "slot" and "envelope" are precise
and mean nothing to someone who has never read the specification — say "the
button asks the app to fetch something" first and introduce the term only if
they need it back. Show the work as it goes: a card they can look at before
you package it, not a package they discover afterwards.

And explain the reasoning behind each decision, briefly. A user who
understands why a button cannot be wired will design around it next time; a
user who was told a rule will hit the same wall again.

## Outside a host that understands recipes

This package is an ordinary skill file wherever recipes are not a concept: the
text above is then guidance for building a single-file HTML card by hand, and
the reference files are simply documents someone can read. Nothing here
depends on being loaded as a recipe.
