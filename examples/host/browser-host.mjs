import { createLocalStorageStateStore, mountPackage } from '/reference/host.js';
import { executeDemoBinding } from '/gateway.js';

async function boot() {
  const response = await fetch('/bootstrap.json');
  if (!response.ok) {
    throw new Error('The development host could not load its bootstrap data.');
  }
  const bootstrap = await response.json();
  const stateStore = createLocalStorageStateStore(window.localStorage);
  const existing = stateStore.get(bootstrap.cardId);
  if (!existing || Object.keys(existing).length === 0) {
    stateStore.set(bootstrap.cardId, bootstrap.initialState);
  }

  const container = document.querySelector('[data-card-host]');
  if (!container) {
    throw new Error('The development host page has no card container.');
  }
  mountPackage({
    container,
    entrySource: bootstrap.entrySource,
    src: bootstrap.cardUrl,
    cardId: bootstrap.cardId,
    stateStore,
    executeBinding: executeDemoBinding,
  });
}

boot().catch((error) => {
  const target = document.querySelector('[data-host-error]');
  if (target) target.textContent = error instanceof Error ? error.message : String(error);
});
