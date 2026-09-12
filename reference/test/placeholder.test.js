import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { CARD_PLACEHOLDER_ATTRIBUTE, CARD_PLACEHOLDER_SOURCE } from '../src/placeholder-source.js';

/**
 * The shim is a source string meant to run inside a card document, so each test
 * opens a real document with it in the head and then fires the event the
 * platform fires when a subresource fails to load.
 *
 * The event is dispatched by the test rather than produced by a real failed
 * fetch: jsdom does not fetch subresources at all, and a suite that needed the
 * network to prove a card works offline would be testing the wrong thing.
 * `dispatchEvent` walks the same capture path a platform-fired resource error
 * walks, which is the path the shim listens on.
 */
function openCard(body) {
  const dom = new JSDOM(
    [
      '<!DOCTYPE html><html><head><meta charset="utf-8">',
      `<script>${CARD_PLACEHOLDER_SOURCE}</script>`,
      '</head><body>',
      body,
      '</body></html>',
    ].join('\n'),
    { runScripts: 'dangerously' },
  );
  const { window } = dom;
  const fail = (node) => node.dispatchEvent(new window.Event('error'));
  return { window, document: window.document, fail };
}

const placeholderIn = (document) => document.querySelector(`[${CARD_PLACEHOLDER_ATTRIBUTE}]`);

describe('the blocked-resource placeholder (section 7.1)', () => {
  it('puts a placeholder where a failed image was', () => {
    const { document, fail } = openCard('<img id="hero" src="https://cdn.example.com/a.png" alt="A harbour at dusk">');
    fail(document.getElementById('hero'));

    const placeholder = placeholderIn(document);
    expect(placeholder).not.toBeNull();
    expect(document.getElementById('hero')).toBeNull();
  });

  it('carries the alternative text, which is the one thing the spec names', () => {
    const { document, fail } = openCard('<img id="hero" src="https://cdn.example.com/a.png" alt="A harbour at dusk">');
    fail(document.getElementById('hero'));
    expect(placeholderIn(document).textContent).toContain('A harbour at dusk');
  });

  it('says why, in the card\'s own words rather than a browser error', () => {
    const { document, fail } = openCard('<img id="hero" src="https://cdn.example.com/a.png" alt="A harbour">');
    fail(document.getElementById('hero'));
    expect(placeholderIn(document).textContent).toContain('This resource is no longer where it was');
  });

  it('keeps the space the resource declared, so the layout does not jump', () => {
    const { document, fail } = openCard('<img id="hero" width="480" height="270" src="https://cdn.example.com/a.png" alt="A harbour">');
    fail(document.getElementById('hero'));
    const placeholder = placeholderIn(document);
    expect(placeholder.style.width).toBe('480px');
    expect(placeholder.style.aspectRatio).toBe('480 / 270');
  });

  it('drops the reason line in an inline-sized slot, where there is no room for it', () => {
    const { document, fail } = openCard('<img id="dot" width="64" height="64" src="https://cdn.example.com/a.png" alt="Avatar">');
    fail(document.getElementById('dot'));
    const placeholder = placeholderIn(document);
    expect(placeholder.textContent).toContain('Avatar');
    expect(placeholder.textContent).not.toContain('This resource is no longer where it was');
  });

  it('still says something when the author left no alternative text', () => {
    const { document, fail } = openCard('<img id="hero" src="https://cdn.example.com/a.png">');
    fail(document.getElementById('hero'));
    expect(placeholderIn(document).textContent).toContain('This resource is no longer where it was');
  });

  it('stands in for a video the same way', () => {
    const { document, fail } = openCard('<video id="clip" src="https://cdn.example.com/a.mp4" poster="https://cdn.example.com/p.png"></video>');
    fail(document.getElementById('clip'));
    expect(placeholderIn(document)).not.toBeNull();
  });

  it('leaves a picture alone when a source fails: the img inside is the one that speaks', () => {
    const { document, fail } = openCard(
      '<picture><source id="alt" srcset="https://cdn.example.com/a.webp"><img id="hero" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A harbour"></picture>',
    );
    fail(document.getElementById('alt'));
    expect(placeholderIn(document)).toBeNull();
    expect(document.getElementById('hero')).not.toBeNull();
  });

  it('does not touch a script error, which is not a resource the reader can see', () => {
    const { window, document } = openCard('<p id="text">still here</p>');
    window.dispatchEvent(new window.Event('error'));
    expect(placeholderIn(document)).toBeNull();
    expect(document.getElementById('text')).not.toBeNull();
  });

  it('replaces a given element once, however many times it fails', () => {
    const { document, fail } = openCard('<img id="hero" src="https://cdn.example.com/a.png" alt="A harbour">');
    const image = document.getElementById('hero');
    fail(image);
    fail(image);
    expect(document.querySelectorAll(`[${CARD_PLACEHOLDER_ATTRIBUTE}]`)).toHaveLength(1);
  });
});
