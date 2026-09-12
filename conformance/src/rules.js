/**
 * The sets these checks judge against, in one place.
 *
 * Every value below is the specification's own: section 7.3 names the five
 * starter secret patterns as a floor a scan must at least cover, and section
 * 1.4 names the width band. They are restated here as data so the checker has
 * something to iterate and the README has something to publish — not invented
 * here.
 *
 * A floor is not a ceiling. A host validating imports should add the shapes of
 * its own credentials; doing so stays conformant, because the specification
 * asks for at least these.
 *
 * Section 7.2 retired the static ban on network-shaped references and script
 * APIs: a card's entry document may write a `fetch(` call or an `<img src>`
 * pointing at an `https:` host, and whether that ever reaches the network is a
 * runtime permission question (section 3.5), not a static one. Nothing in this
 * file enumerates a bypass-channel token list or a forbidden-reference set any
 * more — the rules below cover only what section 9.3 keeps: manifest shape,
 * secret scanning, title, and package structure.
 */

/**
 * Starter secret patterns (section 7.3: a card package is a forwardable file,
 * so a secret burned into one is a leaked secret).
 *
 * Findings never echo the matched text — a scanner that prints the secret it
 * found has moved the secret into the log.
 */
export const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ name: 'aws-access-key-id', pattern: /AKIA[0-9A-Z]{16}/g }),
  Object.freeze({ name: 'openai-style-api-key', pattern: /sk-[A-Za-z0-9]{20,}/g }),
  Object.freeze({ name: 'github-personal-access-token', pattern: /ghp_[A-Za-z0-9]{36}/g }),
  Object.freeze({ name: 'pem-private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g }),
  Object.freeze({ name: 'bearer-token', pattern: /Bearer [A-Za-z0-9._~+/-]{20,}/g }),
]);

/**
 * The band a declared initial width has to land in (section 1.4).
 *
 * The floor is a card too narrow to lay anything out at all; the ceiling is
 * wider than any surface would give a single card. Neither is an opinion about
 * what width suits a card — that is the author's — they are the two points past
 * which a number has stopped being a width.
 */
export const PREFERRED_WIDTH_MIN_PX = 240;
export const PREFERRED_WIDTH_MAX_PX = 1200;

/** Marker attribute of the static declaration block (section 1.4). */
export const MANIFEST_MARKER_ATTRIBUTE = 'data-card-manifest';

/** Marker attribute of the static state snapshot block (section 1.5). */
export const STATE_MARKER_ATTRIBUTE = 'data-card-state';

/** The contract version a manifest without a `spec` field means (section 1.4 / 6.7). */
export const DEFAULT_SPEC_VERSION = '1.0';

/** The fixed entry file name of a card package (section 6.1). */
export const PACKAGE_ENTRY_NAME = 'index.html';

/**
 * Titles shaped like an identifier rather than a sentence (section 1.3 forbids
 * snake_case and its relatives). Warning level: "natural language" is a SHOULD
 * whose edges no regular expression owns.
 */
export const IDENTIFIER_STYLE_TITLE_PATTERNS = Object.freeze([
  /^[a-z0-9]+([_-][a-z0-9]+)+$/,
  /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/,
]);
