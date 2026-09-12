/**
 * Test harness for the host side.
 *
 * jsdom does not run scripts inside an iframe, so the fixture plays the part of
 * the card: it posts `card:request` messages with the iframe as their source and
 * collects the `card:response` messages the host sends back. Everything the host
 * does in between is the real code path.
 */

import { vi } from 'vitest';

import { mountCard } from '../../src/host.js';
import { CARD_REQUEST_TYPE } from '../../src/codes.js';

let requestCounter = 0;

export function createHostFixture(options = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const mounted = mountCard({
    container,
    cardId: 'card-1',
    cardSource: '<!DOCTYPE html><html><head><title>Fixture card</title></head><body><p>card</p></body></html>',
    ...options,
  });

  const answers = [];
  const cardWindow = mounted.iframe.contentWindow;
  vi.spyOn(cardWindow, 'postMessage').mockImplementation((message) => {
    answers.push(message);
  });

  const fixture = {
    container,
    mounted,
    answers,
    cardWindow,

    /** Post a request the way the card would, and wait for its answer. */
    async ask(capability, payload) {
      requestCounter += 1;
      const requestId = `test-request-${requestCounter}`;
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: CARD_REQUEST_TYPE, requestId, capability, payload },
          source: cardWindow,
        }),
      );
      const answer = await waitFor(() => answers.find((message) => message.requestId === requestId));
      return answer;
    },

    /** Post a raw message, for the cases where the shape itself is under test. */
    post(data, source = cardWindow) {
      window.dispatchEvent(new MessageEvent('message', { data, source }));
    },

    teardown() {
      mounted.unmount();
      container.remove();
    },
  };

  return fixture;
}

export async function waitFor(read, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    const value = read();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('timed out waiting for a host answer');
}

export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
