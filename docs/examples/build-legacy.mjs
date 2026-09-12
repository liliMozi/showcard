/**
 * Build the example cards that run on the website's front page.
 *
 * Build time only: it writes the `*.card.html` files next to itself, and the
 * generated files are what ship. Nothing on the page loads this script.
 *
 *   node docs/examples/build.mjs
 *
 * These three are degenerate packages (section 6.2): each is a single
 * complete document, no `assets/` of its own — the picture each one carries
 * is inlined as a data URI so the file stays openable on its own (section
 * 1.2). They predate the package redefinition and are kept exactly as an
 * example of that shape; `docs/examples/weather-package/` is the newer
 * example, a real directory package with its own `assets/`.
 *
 * The injection goes through the reference export pipeline rather than a hand
 * copy of the runtime, so what these files carry is the same injection layer the
 * conformance suite tests: the policy meta tag, the runtime, and the
 * placeholder shim of section 6.4's export equipment, pushed into a complete
 * document each card body below is assembled into.
 *
 * A note on height, since all three sit in equal frames on the front page.
 * Every band inside a card is given a height in pixels rather than one derived
 * from the card's width, so a card is exactly as tall at 280px wide as it is at
 * 720px. That is what lets one fixed frame hold any of them at any page width
 * without a scrollbar appearing inside.
 *
 * The obvious alternative — `height: 100%` on the document plus
 * `overflow: hidden` — is the thing section 1.7 forbids an author to do
 * unconditionally: a card is often unmarked (nobody has told it which end
 * decides its height), and an unmarked card must stay readable as a plain stack
 * of content. Clipping it would mean a card opened in a short window loses its
 * last lines with no way to scroll to them. So the fill-the-frame layout hangs
 * off `data-card-sizing="viewport"`, exactly as section 1.7 writes it: when a
 * host says the frame decides, the picture and the writing area stretch to it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { injectRuntimeIntoDocument } from '../../reference/src/wrap.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Artwork lives in `assets/` as an ordinary image file and is inlined here as a
 * data URI, because a card has to be openable on its own (section 1.2): a
 * picture loaded from a neighbouring file would be a blank frame the moment the
 * card is mailed to someone. The repository keeps the picture in its own format
 * so it stays viewable and replaceable; only the generated card carries base64.
 */
async function dataUri(name, mediaType) {
  const bytes = await readFile(join(HERE, 'assets', name));
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

const WEATHER_HERO = await dataUri('weather-hero.webp', 'image/webp');
const NOTE_HEADER = await dataUri('note-header.jpg', 'image/jpeg');

/* ---- 1. Weather ---------------------------------------------------------- */

const WEATHER = `<script type="application/json" data-card-manifest>
{
  "spec": "1.0",
  "display": { "preferredWidthPx": 360 },
  "toolBindings": {
    "refresh": {
      "tool": "fetch.request",
      "input": { "hosts": ["api.open-meteo.com"] },
      "description": "Refresh the Shanghai forecast"
    }
  }
}
</script>

<style>
  :root { color-scheme: light; }
  html, body { background: #faf7f2; }
  body {
    margin: 0;
    color: #2b2722;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-size: 15px;
    line-height: 1.6;
  }
  [hidden] { display: none !important; }

  .wx { display: flex; flex-direction: column; }

  /* The picture runs to the card's own edge: section 1.1 gives the whole canvas
     to the card, and the wrapper adds no margin of its own to fight. Its height
     is a fixed band rather than an aspect ratio, so the card's total height does
     not move when the card is handed a different width. */
  .wx-hero { position: relative; height: 345px; overflow: hidden; }
  .wx-sky { display: block; width: 100%; height: 100%; object-fit: cover; }
  /* Ink on the quiet middle of the picture, above the ridge line. */
  .wx-over { position: absolute; left: 22px; right: 22px; top: 42%; color: #3a3732; }
  .wx-city { margin: 0; font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; }
  .wx-now { display: flex; align-items: baseline; gap: 7px; margin: 4px 0 0; }
  .wx-temp { font-size: 2.6rem; line-height: 1; letter-spacing: -0.02em; }
  .wx-unit { font-size: 0.95rem; letter-spacing: 0.02em; }
  .wx-cond { margin: 2px 0 0; font-size: 13px; font-style: italic; }

  .wx-body { padding: 14px 22px; }
  .wx-days { margin: 0; padding: 0; list-style: none; font-size: 12.5px; }
  .wx-days li {
    display: grid;
    grid-template-columns: 3.4em 1fr auto;
    gap: 10px;
    padding: 1px 0;
    align-items: baseline;
  }
  .wx-days .d { color: #8a8174; letter-spacing: 0.08em; font-size: 11.5px; text-transform: uppercase; }
  .wx-days .w { color: #5d564b; }
  .wx-days .r { font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
  .wx-foot { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 0; }
  .wx-refresh {
    appearance: none;
    font: inherit;
    font-size: 11.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #2b2722;
    background: transparent;
    border: 1px solid #cec5b5;
    border-radius: 0;
    padding: 5px 13px;
    cursor: pointer;
  }
  .wx-refresh:hover { border-color: #537d96; color: #3f6179; }
  .wx-refresh:focus-visible { outline: 1px solid #537d96; outline-offset: 2px; }
  .wx-out { font-size: 11.5px; color: #8a8174; overflow: hidden; }
  .wx-note { margin: 9px 0 0; font-size: 11px; line-height: 1.5; color: #8a8174; }
  .wx-note code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }

  /* Section 1.7: only when the host says the frame decides the height does the
     card fill it, and only then is clipping safe. Unmarked, everything above
     stays a stack of content that flows. */
  html[data-card-sizing="viewport"],
  html[data-card-sizing="viewport"] body { height: 100%; }
  html[data-card-sizing="viewport"] body { overflow: hidden; }
  html[data-card-sizing="viewport"] .wx { height: 100%; }
  html[data-card-sizing="viewport"] .wx-hero { height: auto; flex: 1 1 0; min-height: 0; }
</style>

<article class="wx">
  <div class="wx-hero">
    <!-- Decorative: the reading itself is the text laid over it. -->
    <img class="wx-sky" src="${WEATHER_HERO}" alt="" width="960" height="960">
    <div class="wx-over">
      <p class="wx-city">Shanghai</p>
      <p class="wx-now"><span class="wx-temp">18</span><span class="wx-unit">&deg;C</span></p>
      <p class="wx-cond">Partly cloudy, wind from the north</p>
    </div>
  </div>

  <div class="wx-body">
    <ul class="wx-days">
      <li><span class="d">Mon</span><span class="w">Clear</span><span class="r">21&deg; / 11&deg;</span></li>
      <li><span class="d">Tue</span><span class="w">Cloudy</span><span class="r">19&deg; / 12&deg;</span></li>
      <li><span class="d">Wed</span><span class="w">Rain, easing</span><span class="r">16&deg; / 10&deg;</span></li>
    </ul>

    <!-- Section 2.7: the button is wired declaratively. data-invoke calls the
         binding the manifest declared, data-result renders what came back. -->
    <p class="wx-foot">
      <button class="wx-refresh" type="button" data-invoke="refresh">Refresh</button>
      <output class="wx-out" data-result="refresh"></output>
    </p>

    <p class="wx-note" id="wx-standalone" hidden>
      No host here: Refresh answers <code>CARD_HOST_TOOL_UNAVAILABLE</code>, so these are sample figures.
    </p>
  </div>
</article>

<script>
  /* Section 3.4: a well-mannered card asks the way at startup and annotates the
     controls that need a host. The answer decides whether the line above is
     shown; clicking Refresh without a host is harmless either way, because the
     shim turns the missing tool channel into a failure envelope rather than an
     exception. */
  (function () {
    var note = document.getElementById('wx-standalone');
    if (!note || !window.card || typeof window.card.capabilities !== 'function') { return; }
    window.card.capabilities().then(function (envelope) {
      var answered = envelope && envelope.ok && envelope.result && envelope.result.capabilities;
      var invoke = answered ? envelope.result.capabilities.invoke : 'requires_host';
      if (invoke === 'requires_host') { note.hidden = false; }
    });
  })();
</script>
`;

/* ---- 2. Piano ------------------------------------------------------------ */

/** Bottom to top, the way the keyboard is drawn: C4 lowest. */
const WHITE_KEYS = [
  ['C4', 261.63, 'a'],
  ['D4', 293.66, 's'],
  ['E4', 329.63, 'd'],
  ['F4', 349.23, 'f'],
  ['G4', 392.0, 'g'],
  ['A4', 440.0, 'h'],
  ['B4', 493.88, 'j'],
  ['C5', 523.25, 'k'],
];

/** Each black key straddles the seam above the white key at `seam` (1-based). */
const BLACK_KEYS = [
  ['C#4', 277.18, 'w', 1],
  ['D#4', 311.13, 'e', 2],
  ['F#4', 369.99, 't', 4],
  ['G#4', 415.3, 'y', 5],
  ['A#4', 466.16, 'u', 6],
];

const WHITE_HEIGHT_PCT = 100 / WHITE_KEYS.length;
const BLACK_HEIGHT_PCT = WHITE_HEIGHT_PCT * 0.56;

function keyButton(className, [note, freq, letter], extraStyle = '') {
  const style = extraStyle === '' ? '' : ` style="${extraStyle}"`;
  return (
    `    <button class="${className}" type="button"${style} data-note="${note}" ` +
    `data-freq="${freq}" data-key="${letter}" aria-label="${note}">` +
    `<span class="pn-cap">${letter.toUpperCase()}</span></button>`
  );
}

const PIANO_KEYS = [
  ...WHITE_KEYS.map((key) => keyButton('pn-white', key)),
  ...BLACK_KEYS.map((key) =>
    keyButton(
      'pn-black',
      key,
      `bottom: ${(key[3] * WHITE_HEIGHT_PCT - BLACK_HEIGHT_PCT / 2).toFixed(3)}%; height: ${BLACK_HEIGHT_PCT.toFixed(3)}%`,
    ),
  ),
].join('\n');

const PIANO = `<!-- No manifest block here, on purpose. Section 1.4: a card with no need to
     communicate with a host may omit the declaration entirely. This one asks for
     nothing — no state, no tools — so it declares nothing at all. Its identity
     is the host's business, assigned and held there, never written into the
     package (section 1.3). -->

<style>
  :root { color-scheme: light; }
  html, body { background: #faf7f2; }
  body {
    margin: 0;
    color: #2b2722;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-size: 15px;
    line-height: 1.6;
  }
  .pn { display: flex; flex-direction: column; padding: 22px 24px 20px; }
  .pn-title {
    margin: 0 0 14px;
    font-size: 11px;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #8a8174;
  }
  /* Laid out the way a keyboard stands on end: pitch rises upward, so the keys
     are stacked in reverse and C4 sits at the bottom. */
  .pn-keys {
    position: relative;
    display: flex;
    flex-direction: column-reverse;
    height: 420px;
    border: 1px solid #cec5b5;
    background: #fffdf9;
    touch-action: none;
  }
  .pn-white, .pn-black {
    appearance: none;
    font: inherit;
    border: 0;
    border-radius: 0;
    margin: 0;
    cursor: pointer;
    touch-action: none;
    display: flex;
    align-items: center;
  }
  .pn-white {
    position: relative;
    flex: 1 1 0;
    background: transparent;
    padding: 0 0 0 11px;
    justify-content: flex-start;
  }
  /* The seam hangs off the underside of every key but the lowest, so the bottom
     key never doubles its line against the frame's own border. */
  .pn-white + .pn-white { border-bottom: 1px solid #e4ddd1; }
  .pn-white.is-down { background: #f1e8d9; }
  .pn-black {
    position: absolute;
    right: 0;
    width: 60%;
    background: #2b2722;
    padding: 0 11px 0 0;
    justify-content: flex-end;
    z-index: 2;
  }
  .pn-black.is-down { background: #6d6357; }
  .pn-cap { font-size: 10px; letter-spacing: 0.1em; color: #b0a696; }
  .pn-black .pn-cap { color: #8d8577; }
  .pn-white:focus-visible, .pn-black:focus-visible { outline: 1px solid #537d96; outline-offset: -2px; }
  .pn-hint { margin: 12px 0 0; font-size: 11.5px; line-height: 1.5; color: #8a8174; }
  .pn-hint b { font-weight: 400; letter-spacing: 0.18em; color: #5d564b; }

  /* Section 1.7, as above: stretch only where the host says the frame decides. */
  html[data-card-sizing="viewport"],
  html[data-card-sizing="viewport"] body { height: 100%; }
  html[data-card-sizing="viewport"] body { overflow: hidden; }
  html[data-card-sizing="viewport"] .pn { height: 100%; box-sizing: border-box; }
  html[data-card-sizing="viewport"] .pn-keys { height: auto; flex: 1 1 0; min-height: 0; }
</style>

<div class="pn">
  <p class="pn-title">One octave</p>
  <div class="pn-keys" role="group" aria-label="Piano keys, C4 to C5">
${PIANO_KEYS}
  </div>
  <p class="pn-hint">Press a key, or play the row <b>a w s e d f t g y h u j k</b>.</p>
</div>

<script>
  /* Zero dependencies and no network: the sound is an oscillator per strike,
     built where it is heard. Nothing here leaves the document. */
  (function () {
    var keys = document.querySelectorAll('[data-freq]');
    var byLetter = {};
    var held = {};
    var context = null;
    var index;

    for (index = 0; index < keys.length; index += 1) {
      byLetter[keys[index].getAttribute('data-key')] = keys[index];
    }

    function audio() {
      if (context === null) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) { return null; }
        try { context = new Ctor(); } catch (error) { return null; }
      }
      if (context.state === 'suspended' && typeof context.resume === 'function') { context.resume(); }
      return context;
    }

    function strike(element) {
      var ac = audio();
      if (!ac) { return; }
      var frequency = parseFloat(element.getAttribute('data-freq'));
      if (!isFinite(frequency)) { return; }
      var at = ac.currentTime;
      var oscillator = ac.createOscillator();
      var softener = ac.createBiquadFilter();
      var envelope = ac.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      softener.type = 'lowpass';
      softener.frequency.value = 2200;
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(0.11, at + 0.014);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
      oscillator.connect(softener);
      softener.connect(envelope);
      envelope.connect(ac.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.9);
    }

    function press(element) {
      if (!element || element.classList.contains('is-down')) { return; }
      element.classList.add('is-down');
      strike(element);
    }

    function release(element) {
      if (element) { element.classList.remove('is-down'); }
    }

    function keyUnder(target) {
      return target && typeof target.closest === 'function' ? target.closest('[data-freq]') : null;
    }

    document.addEventListener('pointerdown', function (event) {
      var element = keyUnder(event.target);
      if (!element) { return; }
      // Keep the press from turning into a text selection or a scroll gesture;
      // several fingers at once are several independent notes.
      event.preventDefault();
      held[event.pointerId] = element;
      press(element);
    });

    // Sliding along the keyboard sounds each key it crosses. The element under
    // the pointer is looked up by position rather than taken from the event,
    // because a touch keeps delivering its moves to the key it started on.
    document.addEventListener('pointermove', function (event) {
      if (!Object.prototype.hasOwnProperty.call(held, event.pointerId)) { return; }
      var element = keyUnder(document.elementFromPoint(event.clientX, event.clientY));
      if (element === held[event.pointerId]) { return; }
      release(held[event.pointerId]);
      if (element) {
        held[event.pointerId] = element;
        press(element);
      } else {
        delete held[event.pointerId];
      }
    });

    function lift(event) {
      var element = held[event.pointerId];
      if (!element) { return; }
      delete held[event.pointerId];
      release(element);
    }

    document.addEventListener('pointerup', lift);
    document.addEventListener('pointercancel', lift);

    // A key reached by Tab and activated with Enter or Space arrives as a click
    // with no pointer behind it (detail 0), which the pointer path never sees.
    document.addEventListener('click', function (event) {
      if (event.detail !== 0) { return; }
      var element = keyUnder(event.target);
      if (!element) { return; }
      press(element);
      window.setTimeout(function () { release(element); }, 150);
    });

    document.addEventListener('keydown', function (event) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) { return; }
      var element = byLetter[String(event.key || '').toLowerCase()];
      if (!element) { return; }
      event.preventDefault();
      press(element);
    });

    document.addEventListener('keyup', function (event) {
      release(byLetter[String(event.key || '').toLowerCase()]);
    });
  })();
</script>
`;

/* ---- 3. Note ------------------------------------------------------------- */

const NOTE = `<script type="application/json" data-card-manifest>
{ "spec": "1.0" }
</script>

<style>
  :root { color-scheme: light; }
  html, body { background: #faf7f2; }
  body {
    margin: 0;
    color: #2b2722;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-size: 15px;
    line-height: 1.6;
  }
  .nt-shell { display: flex; flex-direction: column; }
  .nt-header { display: block; width: 100%; height: 142px; object-fit: cover; }
  .nt { display: flex; flex-direction: column; padding: 20px 24px; }
  .nt-title, .nt-body {
    appearance: none;
    display: block;
    width: 100%;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0;
    margin: 0;
  }
  .nt-title { font-size: 1.16rem; letter-spacing: 0.01em; padding-bottom: 8px; }
  .nt-title::placeholder, .nt-body::placeholder { color: #b3a999; }
  .nt-rule { border: 0; border-top: 1px solid #ded7ca; margin: 0 0 12px; }
  .nt-body { resize: none; line-height: 1.72; }
  .nt-title:focus, .nt-body:focus { outline: none; }
  .nt-title:focus-visible, .nt-body:focus-visible { outline: 1px solid #537d96; outline-offset: 4px; }
  .nt-foot { margin: 14px 0 0; font-size: 11.5px; line-height: 1.5; color: #8a8174; }

  /* Section 1.7, as above: the writing area takes the slack, but only once a
     host has said the frame is what decides. */
  html[data-card-sizing="viewport"],
  html[data-card-sizing="viewport"] body { height: 100%; }
  html[data-card-sizing="viewport"] body { overflow: hidden; }
  html[data-card-sizing="viewport"] .nt-shell { height: 100%; }
  html[data-card-sizing="viewport"] .nt { flex: 1 1 0; min-height: 0; box-sizing: border-box; }
  html[data-card-sizing="viewport"] .nt-body { flex: 1 1 0; min-height: 0; height: auto; }
</style>

<div class="nt-shell">
  <!-- Decorative header, inlined so the note travels whole. -->
  <img class="nt-header" src="${NOTE_HEADER}" alt="" width="1000" height="428">
  <!-- Section 2.7: data-persist is the whole wiring. The value is read from
       state when the card opens and written back when the field is left; not one
       line of script is involved. -->
  <article class="nt">
    <input class="nt-title" type="text" data-persist="title" aria-label="Note title" value="Shanghai, second morning">
    <hr class="nt-rule">
    <textarea class="nt-body" data-persist="body" rows="10" aria-label="Note body" spellcheck="false">Coffee at the counter before the temple opens. The rain stopped somewhere around four and left the stone dark.

Ask about the paper shop on the corner.</textarea>
    <p class="nt-foot">What you write here is this card's state, saved when you leave the field.</p>
  </article>
</div>
`;

/* ---- assembly ------------------------------------------------------------ */

/**
 * Wrap a card's body content into the complete document section 1.1 asks an
 * entry to be. A browser gives `body` a default margin, so the reset zeroes
 * it — the same reset the old fragment-wrapping host used to add, kept here
 * now that each card assembles its own skeleton instead of being wrapped in
 * one (section 1.1's redefinition note).
 */
function assembleDocument({ title, body }) {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    '<style>html, body { margin: 0; padding: 0; }</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const CARDS = [
  { file: 'weather.card.html', title: 'Shanghai Weather', body: WEATHER },
  { file: 'piano.card.html', title: 'One Octave', body: PIANO },
  { file: 'note.card.html', title: 'A Paper Note', body: NOTE },
];

for (const card of CARDS) {
  const document = injectRuntimeIntoDocument(assembleDocument(card));
  const path = join(HERE, card.file);
  await writeFile(path, document, 'utf8');
  process.stdout.write(`${card.file}  ${Buffer.byteLength(document)} bytes\n`);
}
