/**
 * Card package static checks (specification section 9.3).
 *
 * A pure function over card text: no DOM, no dependencies, no I/O. That is a
 * requirement rather than a preference — the CLI in `../bin/check-card.mjs` runs
 * on a bare Node install, and a checker that needs a browser cannot sit in a
 * mint or import path (section 5.4).
 *
 * The scanner reads text, not a parse tree. An HTML parser is forgiving by
 * design: it drops what it cannot make sense of, and everything it drops is
 * exactly what a card author should have to answer for. So tags are located by
 * scanning, raw-text elements are read to their closing tag, and the secret scan
 * runs over the whole package including comments.
 *
 * Section 9.3 collapsed the rule set down to a structural minimum: this suite
 * used to also enumerate a forbidden-API token list and a network-reference ban
 * (a card could not write `fetch(` or an `<img src="https://…">`). Both are
 * retired as of the section 7.2 rewrite — network access is a runtime
 * permission a host negotiates (section 3.5), not a shape a static scanner can
 * judge in advance — along with the card-id-burned-in and size-budget checks,
 * which belonged to the fragment-and-wrapper model this package format
 * replaced. What is left is what section 9.3 keeps: can the entry document be
 * parsed, is the manifest (and its `toolBindings`) legal JSON of a legal shape,
 * does a relative reference stay inside the package it travels in, does the
 * package leak a secret, and does it carry a human title.
 *
 * Findings are `{ rule, level, message, file, line }`. `level` is `"error"` for
 * a MUST in the specification and `"warning"` for a SHOULD or a suite-defined
 * convention. `file` is the package-relative path the finding belongs to —
 * always `"index.html"` for a single checked document.
 */

import {
  DEFAULT_SPEC_VERSION,
  IDENTIFIER_STYLE_TITLE_PATTERNS,
  MANIFEST_MARKER_ATTRIBUTE,
  PACKAGE_ENTRY_NAME,
  PREFERRED_WIDTH_MAX_PX,
  PREFERRED_WIDTH_MIN_PX,
  SECRET_PATTERNS,
  STATE_MARKER_ATTRIBUTE,
} from './rules.js';

/** Elements whose content is text, not markup: scanning must skip to the close tag. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'title', 'textarea']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decodeEntities(value) {
  return String(value).replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name) => ENTITIES[name]);
}

function parseAttributes(raw) {
  const attributes = {};
  const pattern = /([a-zA-Z_:@][-a-zA-Z0-9_:.@]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    // First wins, the way a browser resolves a repeated attribute.
    if (!Object.prototype.hasOwnProperty.call(attributes, name)) {
      attributes[name] = decodeEntities(value);
    }
  }
  return attributes;
}

/**
 * Blank out comment bodies while preserving every offset, so structural scans
 * ignore commented-out markup and reported line numbers still point at the file.
 */
function blankComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Locate every start tag, reading raw-text elements through to their close tag.
 *
 * @returns {Array<{ name: string, attributes: object, content: string|null, index: number }>}
 */
export function scanElements(text) {
  const source = blankComments(String(text ?? ''));
  const elements = [];
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    const rawAttributes = match[2];
    const element = {
      name,
      attributes: parseAttributes(rawAttributes),
      content: null,
      index: match.index,
    };

    if (RAW_TEXT_ELEMENTS.has(name) && !/\/\s*$/.test(rawAttributes)) {
      const contentStart = tagPattern.lastIndex;
      const rest = source.slice(contentStart);
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(rest);
      element.content = close ? rest.slice(0, close.index) : rest;
      // An unclosed raw-text element swallows the rest of the file, which is what
      // a browser does too.
      tagPattern.lastIndex = close ? contentStart + close.index + close[0].length : source.length;
    }

    elements.push(element);
  }

  return elements;
}

function lineAt(source, index) {
  if (index < 0) {
    return 0;
  }
  let line = 1;
  for (let at = 0; at < index && at < source.length; at += 1) {
    if (source[at] === '\n') {
      line += 1;
    }
  }
  return line;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonScriptBlock(element, markerAttribute) {
  return (
    element.name === 'script' &&
    String(element.attributes.type || '').trim().toLowerCase() === 'application/json' &&
    Object.prototype.hasOwnProperty.call(element.attributes, markerAttribute)
  );
}

/**
 * Read a static JSON declaration block (manifest, section 1.4, or state
 * snapshot, section 1.5) out of document text without judging it.
 *
 * @returns {{ blocks: Array, value: object|null, parseError: string|null }}
 */
function readJsonBlock(text, markerAttribute) {
  const blocks = scanElements(text).filter((element) => isJsonScriptBlock(element, markerAttribute));
  if (blocks.length === 0) {
    return { blocks, value: null, parseError: null };
  }
  let value;
  try {
    value = JSON.parse(blocks[0].content || '');
  } catch (error) {
    return { blocks, value: null, parseError: String(error.message || error) };
  }
  if (!isPlainObject(value)) {
    return { blocks, value: null, parseError: 'the block is not a JSON object' };
  }
  return { blocks, value, parseError: null };
}

/** Read the manifest out of an entry document's text without judging it (section 1.4). */
export function readManifest(text) {
  const { blocks, value, parseError } = readJsonBlock(text, MANIFEST_MARKER_ATTRIBUTE);
  return { blocks, manifest: value, parseError };
}

/** Read the state snapshot out of an entry document's text without judging it (section 1.5). */
export function readStateSnapshot(text) {
  const { blocks, value, parseError } = readJsonBlock(text, STATE_MARKER_ATTRIBUTE);
  return { blocks, state: value, parseError };
}

/** True for text that carries its own document skeleton (section 1.1: the entry always does). */
export function isFullDocument(source) {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(String(source ?? ''));
}

/* ---- manifest and state block rules -------------------------------------- */

function checkManifest(source, add) {
  const { blocks, manifest, parseError } = readManifest(source);

  if (blocks.length > 1) {
    add('manifest-duplicate', 'error', `a card declares at most one manifest block; found ${blocks.length}`, blocks[1].index);
  }
  if (blocks.length === 0) {
    return;
  }
  if (parseError) {
    add('manifest-invalid-json', 'error', `the manifest must be valid JSON: ${parseError}`, blocks[0].index);
    return;
  }
  // Section 1.4: a missing `spec` reads as 1.0, so only a present-but-wrong one
  // is a finding. Unknown fields are never a finding (tolerant parsing).
  if (Object.prototype.hasOwnProperty.call(manifest, 'spec') && typeof manifest.spec !== 'string') {
    add('manifest-spec-not-string', 'error', 'the manifest `spec` field must be a string', blocks[0].index);
  }
  checkDisplay(manifest, blocks[0].index, add);
  checkStateSchema(manifest, blocks[0].index, add);
  checkToolBindings(manifest, blocks[0].index, add);
}

/**
 * The display preferences of section 1.4, at warning level throughout.
 *
 * A width is a preference, not a permission, and section 1.4 already has the
 * rendering side treat an unacceptable one as no declaration at all — the card
 * lands on the host's default and keeps working. So the author is told, and
 * nothing is failed: an error here would report a misunderstanding as a danger.
 * A fraction is not a finding either, because it is rounded rather than refused.
 */
function checkDisplay(manifest, index, add) {
  if (!Object.prototype.hasOwnProperty.call(manifest, 'display')) {
    return;
  }
  const display = manifest.display;
  if (!isPlainObject(display)) {
    add('manifest-display-not-object', 'warning', 'the manifest `display` block must be a JSON object', index);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(display, 'preferredWidthPx')) {
    return;
  }
  const declared = display.preferredWidthPx;
  if (typeof declared !== 'number' || !Number.isFinite(declared)) {
    add('manifest-display-width', 'warning', '`display.preferredWidthPx` must be a finite number of pixels', index);
    return;
  }
  if (declared < PREFERRED_WIDTH_MIN_PX || declared > PREFERRED_WIDTH_MAX_PX) {
    add(
      'manifest-display-width',
      'warning',
      `\`display.preferredWidthPx\` must be between ${PREFERRED_WIDTH_MIN_PX} and ${PREFERRED_WIDTH_MAX_PX}; ${declared} is outside the band`,
      index,
    );
  }
}

/**
 * `toolBindings` shape (section 1.4 / 4.2, kept at error level by section 9.3:
 * "manifest 合法 JSON、静态内嵌，toolBindings 形状合法"). This does not judge
 * whether a named tool exists or a domain is sound — that is a host's runtime
 * concern (section 4.2) — only that the declaration is a shape a gateway could
 * ever act on: an object of binding id to a binding with a `tool` name.
 */
/**
 * The optional stateSchema of section 1.4. A non-object is an error at the
 * static layer; presentation still treats it as undeclared. Keyword shape
 * beyond "is this an object" is a host concern.
 */
function checkStateSchema(manifest, index, add) {
  if (!Object.prototype.hasOwnProperty.call(manifest, 'stateSchema')) {
    return;
  }
  if (!isPlainObject(manifest.stateSchema)) {
    add('manifest-stateschema-not-object', 'error', 'the manifest `stateSchema` block must be a JSON object', index);
  }
}

function checkToolBindings(manifest, index, add) {
  if (!Object.prototype.hasOwnProperty.call(manifest, 'toolBindings')) {
    return;
  }
  const bindings = manifest.toolBindings;
  if (!isPlainObject(bindings)) {
    add(
      'manifest-toolbindings-not-object',
      'error',
      'the manifest `toolBindings` field must be a JSON object mapping a binding id to a binding declaration',
      index,
    );
    return;
  }
  for (const [bindingId, binding] of Object.entries(bindings)) {
    if (!isPlainObject(binding)) {
      add('manifest-toolbinding-shape', 'error', `the binding ${JSON.stringify(bindingId)} must be a JSON object`, index);
      continue;
    }
    if (typeof binding.tool !== 'string' || binding.tool.trim() === '') {
      add(
        'manifest-toolbinding-shape',
        'error',
        `the binding ${JSON.stringify(bindingId)} needs a \`tool\` field naming the tool it calls (section 4.2)`,
        index,
      );
    }
    if (Object.prototype.hasOwnProperty.call(binding, 'input') && !isPlainObject(binding.input)) {
      add(
        'manifest-toolbinding-shape',
        'error',
        `the binding ${JSON.stringify(bindingId)}'s \`input\` must be a JSON object`,
        index,
      );
    }
    if (Object.prototype.hasOwnProperty.call(binding, 'description') && typeof binding.description !== 'string') {
      add(
        'manifest-toolbinding-shape',
        'error',
        `the binding ${JSON.stringify(bindingId)}'s \`description\` must be a string`,
        index,
      );
    }
  }
}

function checkStateSnapshot(source, add) {
  const { blocks, parseError } = readStateSnapshot(source);
  if (blocks.length > 1) {
    add('state-duplicate', 'error', `a card declares at most one state snapshot block; found ${blocks.length}`, blocks[1].index);
  }
  if (blocks.length === 0) {
    return;
  }
  if (parseError) {
    add('state-invalid-json', 'error', `the state snapshot must be valid JSON: ${parseError}`, blocks[0].index);
  }
}

/* ---- relative references stay inside the package (section 7.2 / 9.3) ----- */

/** Any URL scheme (`http:`, `https:`, `data:`, `blob:`, `mailto:`, …), or a same-document fragment. */
function isNonPackageReference(url) {
  const value = String(url).trim();
  return value === '' || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('#') || value.startsWith('//');
}

/**
 * Resolve a package-relative reference against the directory a file lives in.
 *
 * @returns {string|null} the normalized package-relative path, or `null` when
 *          the reference climbs above the package root (a leading `/` is
 *          treated the same way: a card package has no site root to be
 *          absolute against).
 */
function resolveWithinPackage(fromDir, reference) {
  const clean = String(reference).split(/[?#]/)[0];
  if (clean.startsWith('/')) {
    return null;
  }
  const combined = fromDir ? `${fromDir}/${clean}` : clean;
  const stack = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}

function dirOf(path) {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

/** Attributes that carry a single URL reference, keyed by the element that hosts them. */
const REFERENCE_URL_ATTRIBUTES = Object.freeze({
  script: Object.freeze(['src']),
  img: Object.freeze(['src']),
  source: Object.freeze(['src']),
  video: Object.freeze(['src', 'poster']),
  audio: Object.freeze(['src']),
});

/** Attributes holding a comma-separated candidate list rather than one URL. */
const CANDIDATE_LIST_ELEMENTS = Object.freeze({ img: ['srcset'], source: ['srcset'] });

function srcsetCandidates(value) {
  return String(value)
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((candidate) => candidate !== '');
}

function cssUrlTargets(css) {
  const withoutImports = String(css).replace(/@import[^;]*(?:;|$)/gi, ' ');
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;
  const targets = [];
  let match;
  while ((match = pattern.exec(withoutImports)) !== null) {
    targets.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return targets;
}

function cssImportTargets(css) {
  const pattern = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi;
  const targets = [];
  let match;
  while ((match = pattern.exec(css)) !== null) {
    targets.push(match[1]);
  }
  return targets;
}

/**
 * Every reference a document's markup and CSS make, local or not, with enough
 * context to judge each one: `{ url, index, what }`.
 */
function collectReferences(elements) {
  const references = [];
  const note = (url, index, what) => references.push({ url, index, what });

  for (const element of elements) {
    if (element.name === 'link') {
      const rel = String(element.attributes.rel || '').toLowerCase().split(/\s+/);
      const href = element.attributes.href;
      if (rel.includes('stylesheet') && href !== undefined) {
        note(href, element.index, `the stylesheet href of this <link>`);
      }
    }

    const singleAttributes = REFERENCE_URL_ATTRIBUTES[element.name] || [];
    for (const attribute of singleAttributes) {
      if (element.attributes[attribute] !== undefined) {
        note(element.attributes[attribute], element.index, `the ${attribute} of this <${element.name}>`);
      }
    }

    const listAttributes = CANDIDATE_LIST_ELEMENTS[element.name] || [];
    for (const attribute of listAttributes) {
      if (element.attributes[attribute] === undefined) {
        continue;
      }
      for (const candidate of srcsetCandidates(element.attributes[attribute])) {
        note(candidate, element.index, `an entry in the ${attribute} of this <${element.name}>`);
      }
    }

    const legacyBackground = element.attributes.background;
    if (legacyBackground !== undefined) {
      note(legacyBackground, element.index, `the legacy background attribute of this <${element.name}>`);
    }

    const cssSources = [];
    if (element.name === 'style' && element.content) {
      cssSources.push(element.content);
    }
    if (element.attributes.style) {
      cssSources.push(element.attributes.style);
    }
    for (const css of cssSources) {
      for (const target of cssImportTargets(css)) {
        note(target, element.index, 'this CSS @import');
      }
      for (const target of cssUrlTargets(css)) {
        note(target, element.index, 'this CSS url()');
      }
    }
  }

  return references;
}

/**
 * Section 7.2 / 9.3: a local reference must resolve inside the package it
 * travels in. A reference to another host is no longer this checker's
 * business at all (section 3.5 makes it a runtime permission question), so
 * only references that are *not* a URL scheme, a same-document fragment, or
 * protocol-relative are judged here.
 */
function checkRelativeReferences(source, elements, filePath, add) {
  const fromDir = dirOf(filePath);
  for (const reference of collectReferences(elements)) {
    if (isNonPackageReference(reference.url)) {
      continue;
    }
    const resolved = resolveWithinPackage(fromDir, reference.url);
    if (resolved === null) {
      add(
        'relative-reference-escapes-package',
        'error',
        `${reference.what} points at ${JSON.stringify(reference.url)}, which resolves outside the package root; a card package's relative references stay inside the package it travels in (section 1.1 / 7.2)`,
        reference.index,
      );
    }
  }
}

/* ---- secrets, across every file in the package (section 7.3) ------------- */

function checkSecrets(source, filePath, add) {
  for (const { name, pattern } of SECRET_PATTERNS) {
    // A fresh regex per run: the shared literals carry the /g flag and therefore
    // a lastIndex that would otherwise leak between calls.
    const scanner = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = scanner.exec(source)) !== null) {
      // The match itself is never quoted back: a scanner that prints the secret
      // it found has moved the secret into the log.
      add(
        'secret-pattern',
        'error',
        `this file matches the ${name} secret pattern; a card package is a forwardable file, so a secret in one is a leaked secret`,
        match.index,
      );
      if (match[0] === '') {
        scanner.lastIndex += 1;
      }
    }
  }
}

/* ---- title (section 1.3) -------------------------------------------------- */

function checkTitle(source, elements, add) {
  const title = elements.find((element) => element.name === 'title');
  const text = title ? decodeEntities(String(title.content || '')).trim() : '';

  if (!title || text === '') {
    add('title-missing', 'error', 'a card needs a human-readable title', title ? title.index : 0);
    return;
  }
  if (IDENTIFIER_STYLE_TITLE_PATTERNS.some((pattern) => pattern.test(text))) {
    add(
      'title-not-natural-language',
      'warning',
      `the title ${JSON.stringify(text)} is shaped like an identifier; a title is written in the user's language`,
      title.index,
    );
  }
}

/* ---- entry point ----------------------------------------------------------- */

/** Normalize a path to package-relative POSIX form: no leading `./`, backslashes flipped. */
function normalizePath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Accept whatever shape a caller has on hand and return `Map<string, string>`
 * of package-relative path to text content. A bare string is the single-file
 * shorthand: the whole package is its entry document.
 */
function normalizeFiles(input, entryName) {
  if (typeof input === 'string') {
    return new Map([[entryName, input]]);
  }
  const decoder = new TextDecoder();
  const toText = (value) => (typeof value === 'string' ? value : decoder.decode(value));
  const entries = input instanceof Map ? input.entries() : Object.entries(input ?? {});
  const files = new Map();
  for (const [path, content] of entries) {
    files.set(normalizePath(path), toText(content));
  }
  return files;
}

/**
 * Check one already-read entry document's own rules: manifest, state
 * snapshot, title, and that it is in fact a complete document rather than a
 * fragment (section 1.1 no longer has a fragment input at all).
 */
function checkEntryDocument(source, filePath, add) {
  if (!isFullDocument(source)) {
    add(
      'entry-not-a-document',
      'error',
      "a card's entry is always a complete HTML document — <!DOCTYPE html>, <html>, <head> and <body> — never a fragment for a host to wrap (section 1.1)",
      0,
    );
    return;
  }
  const elements = scanElements(source);
  checkManifest(source, add);
  checkStateSnapshot(source, add);
  checkTitle(source, elements, add);
  checkRelativeReferences(source, elements, filePath, add);
}

/**
 * Check a card package against section 9.3.
 *
 * @param {string|Map<string,string|Uint8Array>|Object<string,string|Uint8Array>} input
 *        a bare document string (the single-file / degenerate-package
 *        shorthand, section 6.2), or a package's files keyed by
 *        package-relative path.
 * @param {{ entry?: string }} [options] `entry` defaults to `index.html`
 *        (section 6.1); only meaningful when `input` is a file map.
 * @returns {{ findings: Array<{ rule: string, level: 'error'|'warning', message: string, file: string, line: number }> }}
 */
export function checkCardPackage(input, options = {}) {
  const entryName = options.entry || PACKAGE_ENTRY_NAME;
  const files = normalizeFiles(input, entryName);
  const findings = [];

  const entrySource = files.get(entryName);
  if (entrySource === undefined) {
    findings.push({
      rule: 'entry-missing',
      level: 'error',
      message: `the package has no ${JSON.stringify(entryName)}; a card package's entry must be named ${JSON.stringify(
        PACKAGE_ENTRY_NAME,
      )} at the package root (section 6.1)`,
      file: entryName,
      line: 0,
    });
  } else {
    const add = (rule, level, message, index) => {
      findings.push({ rule, level, message, file: entryName, line: lineAt(entrySource, index) });
    };
    checkEntryDocument(entrySource, entryName, add);
  }

  // Section 7.3: the secret scan covers the whole package, not only the entry —
  // a credential burned into an asset file is exactly as leaked as one burned
  // into the document.
  for (const [path, text] of files) {
    const add = (rule, level, message, index) => {
      findings.push({ rule, level, message, file: path, line: lineAt(text, index) });
    };
    checkSecrets(text, path, add);
  }

  return { findings };
}

/**
 * Check a single document as a card entry (the common case: a `*.card.html`
 * file, or a package's `index.html` read on its own). Equivalent to
 * `checkCardPackage(text)`.
 */
export function checkCardDocument(text) {
  return checkCardPackage(String(text ?? ''));
}

/** True when a result carries anything at error level. */
export function hasErrors(result) {
  return result.findings.some((finding) => finding.level === 'error');
}
