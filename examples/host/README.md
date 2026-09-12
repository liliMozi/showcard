# Minimal development host

Run the repository's `npm run demo`, then open the loopback address it prints.
The page serves one fixed `index.html` plus `assets/style.css` through a scoped
package URL, mounts it in a sandboxed iframe, persists its `note` state in the
browser's local storage, and permits only the harmless `demo.time.now` binding.
It does not proxy the network, read arbitrary files, execute commands, or
accept arbitrary tool names.

To exercise the reference adapter through the packaged CLI:

```sh
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
```

That adapter intentionally wraps the reference host and shows the adapter
shape an application replaces with its own mount path. A passing run covers
the automatable L1 probe checks only; it does not claim L2 gateway policy or
L3 lifecycle conformance.
