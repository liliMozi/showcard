# Card examples

Weather, piano, note and to-do cards. Each directory contains an HTML source,
local assets, and generated entries in English, Chinese, Japanese and Korean.

```sh
node docs/examples/build.mjs
```

Edit `source.html` and local assets, then rebuild. The build injects the reference
runtime and initial sample data into each `index*.html` entry.

The website host stores state in memory; reloading resets edits. Exported entries
opened directly use browser storage. The weather example displays sample data.

For recipe and artwork attribution, see [Credits & licenses](../credits.html).
