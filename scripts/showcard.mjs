// Build the local CLI assets explicitly, including when npm lifecycle hooks are disabled.
await import('../packages/showcard/scripts/assemble.mjs');
await import('../packages/showcard/bin/showcard.js');
