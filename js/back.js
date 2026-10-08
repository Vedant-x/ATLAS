// Android back button and back gesture (and the browser's Back): close the open panel (slip, quick
// view, search, assistant, display settings) instead of leaving the page, as an app would. Opening a
// panel adds one history entry; Back pops it and closes what is open. Closing a panel any other way
// removes that entry again, so Back never needs pressing twice.
const OPEN = ['#slip.open', '#qv.open', '#display-panel.open', '.pal:not([hidden])', '.ai-root.open'];
const anyOpen = () => OPEN.some((s) => document.querySelector(s));

export function backClosesPanels() {
  let armed = false, queued = false;
  const sync = () => {
    queued = false;
    const open = anyOpen();
    if (open && !armed) { history.pushState({ atlasPanel: true }, ''); armed = true; }
    else if (!open && armed) { armed = false; if (history.state?.atlasPanel) history.back(); }
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sync); } })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  addEventListener('popstate', () => {
    if (!armed) return;
    armed = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  // Following a link out of a panel is a real navigation: its entry stays as the page before.
  addEventListener('hashchange', () => { armed = false; });
}
