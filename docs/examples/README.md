# Website examples

The weather, two-octave piano and Great Wall note packages are adapted from
OpenHanako recipes. The to-do package is used in the OpenHanako chat mock.
Recipe code is Apache-2.0 (`LICENSE-RECIPES`); reference runtime is MIT
(`LICENSE-RUNTIME`). Weather icons credit Bas Milius / Meteocons (MIT).
The Great Wall illustration is CC BY-SA 3.0; see `note/ARTWORK.md` for the source,
artist and changes. Other illustrations retain the recipe license.

Run `node docs/examples/build.mjs` in the specification checkout. Each package's
`source.html` and local assets are the authoring inputs; `index.html` and its zh,
ja and ko variants are generated. `runtime/` is copied from the tested reference
implementation. The original three single-file fixtures remain reproducible via
`build-legacy.mjs`; `weather-package/` remains a minimal package fixture.

`demo-host.js` attaches only to marked, same-site iframes. Each has independent
in-memory state. No tool gateway or conversation is available. The weather is a
dated sample; editing a note or to-do lasts until page reload. When an exported
entry is opened directly, the standard runtime uses local browser storage.

To synchronize the separate Showcard website, run its `examples/build.mjs` with
the specification checkout as the argument after rebuilding here. OpenHanako's
`scripts/sync-cards.mjs` takes the same argument and copies only its chat examples.
