# Recipe Creator

*[中文](./README.zh.md)*

A **recipe** is a skill that teaches an agent to mint one kind of card
(chapter 8 of the specification). This directory is the recipe that teaches an
agent to make recipes.

It is a package with no template of its own: one `SKILL.md` and three
reference documents. The profile marks the package, not its contents.

| File | What is in it |
|------|---------------|
| `SKILL.md` | The interview, in five stages, and the quality loop that closes it |
| `references/binding-criteria.md` | Which candidate actions can be wired to a tool, and what to do with the ones that cannot |
| `references/three-hosts.md` | The walkthrough that turns "what happens on a lesser host" into written-down card behaviour |
| `references/package-shape.md` | Directory, frontmatter, SKILL.md sections, and what makes a template file legal |

## Installing it

Pack the directory as a zip named `recipe-creator.recipe` and install it
through the host's installation channel. `.skill` is the same format under its
compatibility name; a host that has never heard of recipes will read this as an
ordinary skill and the text still makes sense — it is then guidance for writing
a card package by hand, single file or directory either way.

The frontmatter says `default-enabled: false`. A recipe an agent installs on
its own arrives switched off, and the person whose agent it is turns it on.
