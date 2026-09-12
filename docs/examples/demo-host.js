/* Website-only L1 demo host. Each iframe owns its in-memory state; no tool gateway is exposed. */
(function () {
  const base = new URL('.', document.currentScript.src);
  const hosts = new WeakMap();
  let reference;
  async function hostFor(frame) {
    const src = new URL(frame.getAttribute('src'), document.baseURI);
    let record = hosts.get(frame);
    if (!record || record.src !== src.href) {
      const ready = (async () => {
        reference ||= import(new URL('runtime/host.js', base).href);
        const [api, response] = await Promise.all([reference, fetch(src)]);
        if (!response.ok) throw new Error('The example card could not be loaded.');
        const source = await response.text();
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const snapshot = doc.querySelector('[data-card-state]');
        const state = snapshot ? JSON.parse(snapshot.textContent) : {};
        const store = api.createMemoryStateStore();
        const id = crypto.randomUUID();
        store.set(id, state);
        const { bindings, specSupported } = api.readCardManifest(source);
        return api.createCapabilityDispatcher({ cardId: id, stateStore: store, bindings, specSupported });
      })();
      record = { src: src.href, ready };
      hosts.set(frame, record);
    }
    return record.ready;
  }
  window.addEventListener('message', async function (event) {
    const request = event.data;
    if (!request || request.type !== 'card:request' || typeof request.requestId !== 'string') return;
    const frame = Array.from(document.querySelectorAll('iframe[data-showcard]')).find(item => item.contentWindow === event.source);
    if (!frame) return;
    const src = new URL(frame.getAttribute('src'), document.baseURI);
    if (src.origin !== base.origin || !src.pathname.startsWith(base.pathname)) return;
    let envelope;
    try {
      const dispatch = await hostFor(frame);
      if (request.capability === 'emit') {
        envelope = { ok: false, code: 'CARD_HOST_CAPABILITY_NOT_SUPPORTED', error: 'This website demo has no conversation to send to.', result: {} };
      } else {
        envelope = await dispatch(request.capability, request.payload);
        if (request.capability === 'capabilities' && envelope.ok) envelope.result.capabilities.emit = 'requires_host';
      }
    } catch (error) {
      envelope = { ok: false, code: 'CARD_HOST_STORAGE_FAILED', error: String(error.message || error), result: {} };
    }
    if (frame.isConnected && frame.contentWindow === event.source && new URL(frame.getAttribute('src'), document.baseURI).href === src.href) {
      event.source.postMessage({ type: 'card:response', requestId: request.requestId, ...envelope }, '*');
    }
  });
})();
