/**
 * Serve-time injection: push the runtime shim (and the placeholder layer) into
 * an entry document that already is a complete document.
 *
 * Section 1.1: a card's entry is a complete HTML document the author wrote in
 * full — `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, all of it. A host adds to
 * that document only in the response bytes of the request that serves it,
 * never on disk, never in the package itself: `window.card` and the
 * placeholder layer are inserted ahead of everything the document's own head
 * already has (section 2.2), and nothing else about the document moves.
 *
 * This file used to also wrap a *fragment* — a card with no document skeleton
 * of its own — into one the host built around it. That model is retired: a
 * card package has no fragment input any more (section 0.6's redefinition
 * note), so there is nothing left here to wrap, only to inject into.
 */

import { CARD_PLACEHOLDER_SOURCE } from './placeholder-source.js';
import { CARD_RUNTIME_SOURCE } from './runtime-source.js';

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The policy a card document is rendered under by default (section 7.1).
 *
 * Everything a degenerate, single-document card needs is inline or a `data:`
 * payload, so everything else is denied: no subresource may come off the
 * network. What remains open is exactly what such a card is made of — its own
 * inline code, plus `data:` for what it inlines and `blob:` for what its
 * runtime builds while it runs. Take `'unsafe-inline'` away and the card
 * kills itself; that is not a hardening, it is a refusal to render.
 *
 * A package with its own `assets/` needs a wider policy — its script, style
 * and media references are legitimate same-package relative loads, not a
 * network reach — so `mountPackage` (section-serving hosts; see
 * `serve.js`) builds its own instance-scoped policy rather than using this
 * one. This constant is the policy for the single-document mount path
 * (`mountCard`) and for a plain export, where there is no sibling asset to
 * allow in the first place.
 *
 * `sandbox` is not stated here: the iframe attribute in `host.js` carries it.
 *
 * A host serving cards over HTTP states the same policy in a response header.
 * This shim puts a card into an iframe's `srcdoc`, where there is no response
 * to put a header on, so the policy travels in the document.
 */
export const CARD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' data:",
  "style-src 'unsafe-inline' data:",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function policyMetaTag(csp) {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`;
}

/**
 * An author- or export-carried CSP meta AND-s with the one this injector
 * writes (and with a host's response-header policy). Strip it first so the
 * injected policy is the only document-carried one (section 7.8).
 */
function stripDocumentCspMeta(documentSource) {
  return String(documentSource).replace(
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(['"]?)Content-Security-Policy\1)[^>]*\/?>\s*/gi,
    '',
  );
}

/**
 * Inline scripts end at the first `</script`, wherever it appears. The runtime
 * source contains no such sequence today; this keeps that from becoming a
 * silent breakage if it ever does.
 */
function inlineScriptTag(source) {
  return '<script>' + String(source).replace(/<\/script/gi, '<\\/script') + '</script>';
}

function runtimeScriptTag() {
  return inlineScriptTag(CARD_RUNTIME_SOURCE);
}

/**
 * The placeholder layer (section 7.1): what the reader sees where a blocked
 * resource was. It is part of the host's injected layer rather than the card's
 * business, which is why it travels with the runtime.
 */
function placeholderScriptTag() {
  return inlineScriptTag(CARD_PLACEHOLDER_SOURCE);
}

/** True for text that carries its own document skeleton (section 1.1: the entry always does). */
export function isFullDocument(source) {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(String(source));
}

/**
 * Push the policy and the runtime into an entry document that already is a
 * complete document (section 1.1). This is the one shape a card's entry ever
 * has now — there is no fragment branch left to choose between.
 *
 * The injected block goes as early as the document structure allows, so it
 * defines `window.card` before the document's own `<head>` content runs
 * (section 2.2) — including a hand-written standalone shim a legacy export
 * carries (section 6.2), which finds `window.card` already there and steps
 * aside. It is inserted after the doctype rather than in front of it: a
 * document that loses its doctype renders in quirks mode, which would change
 * how it looks from how its author wrote it (section 9.2).
 *
 * @param {string} documentSource the entry document, verbatim
 * @param {{ csp?: string }} [options] `csp` defaults to the single-document
 *        policy (`CARD_CONTENT_SECURITY_POLICY`); a host serving a package
 *        with its own `assets/` passes an instance-scoped policy instead.
 */
export function injectRuntimeIntoDocument(documentSource, options = {}) {
  const source = stripDocumentCspMeta(documentSource);
  const csp = options.csp || CARD_CONTENT_SECURITY_POLICY;
  const script = policyMetaTag(csp) + '\n' + runtimeScriptTag() + '\n' + placeholderScriptTag() + '\n';

  const headOpen = /<head[^>]*>/i.exec(source);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return source.slice(0, at) + '\n' + script + source.slice(at);
  }

  const htmlOpen = /<html[^>]*>/i.exec(source);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return source.slice(0, at) + '\n<head>\n' + script + '</head>' + source.slice(at);
  }

  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return source.slice(0, at) + '\n' + script + source.slice(at);
  }

  return script + source;
}
