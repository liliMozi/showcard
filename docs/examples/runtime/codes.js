/**
 * Shared constants for the reference host shim.
 *
 * Single source of truth: the injection layer source (runtime-source.js) and the
 * host side (host.js) both read their codes and wire constants from here, so the
 * two halves of a request can never drift apart.
 */

/**
 * The error codes defined by the specification (section 2.6).
 * `ok: false` envelopes carry one of these in `code`.
 */
export const CARD_ERROR_CODES = Object.freeze({
  CAPABILITY_REQUIRED: 'CARD_HOST_CAPABILITY_REQUIRED',
  CAPABILITY_NOT_SUPPORTED: 'CARD_HOST_CAPABILITY_NOT_SUPPORTED',
  TOOL_UNAVAILABLE: 'CARD_HOST_TOOL_UNAVAILABLE',
  TIMEOUT: 'CARD_HOST_TIMEOUT',
  POST_FAILED: 'CARD_HOST_POST_FAILED',
  INVALID_RESPONSE: 'CARD_HOST_INVALID_RESPONSE',
  STATE_TOO_LARGE: 'CARD_HOST_STATE_TOO_LARGE',
  STORAGE_UNAVAILABLE: 'CARD_HOST_STORAGE_UNAVAILABLE',
  STORAGE_FAILED: 'CARD_HOST_STORAGE_FAILED',
  CONTRACT_UNSUPPORTED: 'CARD_HOST_CONTRACT_UNSUPPORTED',
  RATE_LIMITED: 'CARD_HOST_RATE_LIMITED',
});

/**
 * Host extension codes. Section 2.6 lets a host add its own codes as long as the
 * `ok` / `code` / `error` envelope shape is preserved, and cards are expected to
 * treat unknown codes as a plain failure. These cover situations the
 * specification table has no entry for:
 *
 * - TOOL_FAILED: a declared binding was executed and the execution itself failed.
 * - INVALID_INPUT: the card called an entry point with unusable arguments (the
 *   five entry points must never throw, so an envelope is the only answer).
 * - NO_ROUTE: emit has no conversation to deliver to (pinned or popped-out
 *   card, no `to`, and no determined focus).
 */
export const CARD_HOST_EXTENSION_CODES = Object.freeze({
  TOOL_FAILED: 'CARD_HOST_TOOL_FAILED',
  INVALID_INPUT: 'CARD_HOST_INVALID_INPUT',
  NO_ROUTE: 'CARD_HOST_EMIT_NO_ROUTE',
});

/** Serialized state budget in bytes (section 2.5: 64 KiB). */
export const STATE_BUDGET_BYTES = 65536;

/** Reference answer deadline in milliseconds (section 2.6: 5 s). */
export const HOST_REQUEST_TIMEOUT_MS = 5000;

/** Prefix of the standalone fallback storage key; the card id completes it (section 2.5). */
export const STATE_KEY_PREFIX = 'card-state:';

/** postMessage types (section 2.8). */
export const CARD_REQUEST_TYPE = 'card:request';
export const CARD_RESPONSE_TYPE = 'card:response';

/**
 * The five capability names. `request(capability, payload)` is the only dispatch
 * point (section 2.3) and the named entry points are conveniences over it, so a
 * card can name any of these directly — which is why section 2.3 freezes the
 * spelling of all five. They are not a shim convention and a host may not
 * rename them; a host's own extension capabilities go alongside, not in place.
 */
export const CAPABILITIES = Object.freeze({
  STATE_GET: 'state.get',
  STATE_SET: 'state.set',
  INVOKE: 'invoke',
  CAPABILITIES: 'capabilities',
  EMIT: 'emit',
});

/** Socket contract versions this host understands (section 6.7). */
export const SUPPORTED_SPEC_VERSIONS = Object.freeze(['1.0']);

/** The version assumed when a manifest omits `spec` (section 1.4 / 6.7). */
export const DEFAULT_SPEC_VERSION = '1.0';
