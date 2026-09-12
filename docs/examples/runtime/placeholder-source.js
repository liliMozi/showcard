/**
 * The blocked-resource placeholder (specification section 7.1).
 *
 * A card may write a network URL on a passive presentation resource, and a host
 * must stop that URL from being fetched (section 1.2). What the reader sees in
 * its place is the host's problem, and section 7.1 gives it a floor: a visual
 * mark that the resource did not load, plus the resource's alternative text if
 * it has one — never the browser's bare broken-image icon, which says "this card
 * is broken" when the truth is "this card, as agreed, did not go to the
 * network".
 *
 * The shim is a source string rather than a module because it has to run inside
 * the card document, next to the card's own code. It is also the shape section
 * 7.7 asks tool-generated cards to carry for themselves, so it is written to be
 * self-contained: one listener, one stylesheet, no imports, no build step.
 *
 * Styling reads the host's theme variables when there are any and falls back to
 * neutral translucent grey when there are not. Section 1.5 forbids this
 * specification from naming variables, so the shim cannot require them; a host
 * with a design system gets its own colours by defining `--well`, `--rule`,
 * `--ink` and `--muted`, and a host without one still gets a placeholder that
 * reads on both light and dark ground.
 */

/** Suite convention: the attribute that marks a node as a placeholder. */
export const CARD_PLACEHOLDER_ATTRIBUTE = 'data-card-placeholder';

/** The reason line. English: the shim runs in cards that have no host locale. */
export const CARD_PLACEHOLDER_REASON = 'This resource is no longer where it was';

export const CARD_PLACEHOLDER_SOURCE = `(function () {
  if (window.__cardPlaceholderInstalled) { return; }
  window.__cardPlaceholderInstalled = true;

  var MARKER = ${JSON.stringify('data-card-placeholder')};
  var REASON = ${JSON.stringify('This resource is no longer where it was')};
  var SVG_NS = 'http://www.w3.org/2000/svg';
  /* Above this width the slot has room for a sentence; at or below it the
     placeholder is standing in for an avatar or an icon and says less. */
  var COMPACT_MAX_PX = 120;

  var CSS = [
    '.card-placeholder{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;',
    'justify-content:center;gap:.35em;max-width:100%;min-width:2.5em;min-height:2.5em;padding:.75em;',
    'border:1px solid var(--rule,rgba(128,128,128,.35));border-radius:8px;',
    'background:var(--well,rgba(128,128,128,.08));color:var(--ink,inherit);text-align:center;overflow:hidden}',
    '.card-placeholder--compact{gap:.2em;padding:.35em;border-radius:6px}',
    '.card-placeholder__icon{width:28px;height:28px;flex:none;opacity:.55}',
    '.card-placeholder--compact .card-placeholder__icon{width:18px;height:18px}',
    '.card-placeholder__alt{font-size:.86rem;line-height:1.3}',
    '.card-placeholder__reason{font-size:.72rem;line-height:1.3;opacity:.65;color:var(--muted,inherit)}'
  ].join('');

  function installStyle() {
    if (document.getElementById('card-placeholder-style')) { return; }
    var style = document.createElement('style');
    style.id = 'card-placeholder-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function svg(name, attributes) {
    var node = document.createElementNS(SVG_NS, name);
    for (var key in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, key)) {
        node.setAttribute(key, attributes[key]);
      }
    }
    return node;
  }

  /* A picture frame with a hill and a sun in it: the drawing every reader
     already knows means "there was an image here". */
  function icon() {
    var root = svg('svg', {
      'class': 'card-placeholder__icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    });
    root.appendChild(svg('rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }));
    root.appendChild(svg('path', { d: 'M5 17.2l4.3-4.7 3.1 3.2L16 12l3 3.4' }));
    root.appendChild(svg('circle', { cx: '9', cy: '9.4', r: '1.4' }));
    return root;
  }

  function measure(node) {
    var declaredWidth = parseFloat(node.getAttribute('width'));
    var declaredHeight = parseFloat(node.getAttribute('height'));
    var rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    return {
      width: isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : (rect && rect.width > 1 ? rect.width : 0),
      height: isFinite(declaredHeight) && declaredHeight > 0 ? declaredHeight : (rect && rect.height > 1 ? rect.height : 0)
    };
  }

  function build(node) {
    var size = measure(node);
    var alt = node.getAttribute ? (node.getAttribute('alt') || '') : '';
    var compact = size.width > 0 && size.width <= COMPACT_MAX_PX;

    var box = document.createElement('div');
    box.setAttribute(MARKER, '');
    box.setAttribute('role', 'img');
    box.className = compact ? 'card-placeholder card-placeholder--compact' : 'card-placeholder';
    box.setAttribute('aria-label', alt ? alt + '. ' + REASON : REASON);
    if (size.width > 0) { box.style.width = size.width + 'px'; }
    if (size.width > 0 && size.height > 0) {
      box.style.aspectRatio = size.width + ' / ' + size.height;
    } else if (size.height > 0) {
      box.style.height = size.height + 'px';
    }

    box.appendChild(icon());
    if (alt) {
      var altLine = document.createElement('span');
      altLine.className = 'card-placeholder__alt';
      altLine.textContent = alt;
      box.appendChild(altLine);
    }
    /* The reason line is dropped in a compact slot only when the alt text is
       already carrying the message; with no alt there would be nothing left. */
    if (!compact || !alt) {
      var reasonLine = document.createElement('span');
      reasonLine.className = 'card-placeholder__reason';
      reasonLine.textContent = REASON;
      box.appendChild(reasonLine);
    }
    return box;
  }

  function replace(node) {
    if (!node || node.__cardPlaceholderDone || !node.parentNode) { return; }
    node.__cardPlaceholderDone = true;
    installStyle();
    node.parentNode.replaceChild(build(node), node);
  }

  /* A <source> that fails inside a <picture> is not a failure the reader sees:
     the browser moves on to the next candidate and the <img> reports for the
     whole element if nothing works. Inside a media element there is no such
     spokesman, so the parent is examined once the browser has settled — and
     only replaced if it ended up with no usable source at all. */
  function considerSourceParent(parent) {
    if (!parent || !parent.tagName) { return; }
    var tag = parent.tagName.toUpperCase();
    if (tag !== 'VIDEO' && tag !== 'AUDIO') { return; }
    window.setTimeout(function () {
      if (parent.networkState === parent.NETWORK_NO_SOURCE) { replace(parent); }
    }, 0);
  }

  /* Resource errors do not bubble; the capture phase is the only place a single
     listener can see all of them. */
  window.addEventListener('error', function (event) {
    var node = event.target;
    if (!node || node === window || !node.tagName) { return; }
    var tag = node.tagName.toUpperCase();
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO') {
      replace(node);
      return;
    }
    if (tag === 'SOURCE') { considerSourceParent(node.parentNode); }
  }, true);
})();`;
