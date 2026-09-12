/** The only binding this development host deliberately authorizes. */
export const DEMO_TIME_BINDING_ID = 'time';
export const DEMO_TIME_TOOL = 'demo.time.now';

/**
 * Run the harmless, no-input demonstration binding.
 *
 * This is deliberately a closed allow-list. A development host must not turn
 * a card's manifest into permission to execute arbitrary code, addresses, or
 * shell commands.
 */
export function executeDemoBinding({ bindingId, binding, input }) {
  if (bindingId !== DEMO_TIME_BINDING_ID || binding?.tool !== DEMO_TIME_TOOL) {
    throw new Error('This development host only authorizes the demo.time.now binding.');
  }
  if (input !== null && input !== undefined) {
    throw new Error('demo.time.now does not accept runtime input.');
  }
  return { iso: new Date().toISOString() };
}
