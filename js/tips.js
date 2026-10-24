// Tips: the extra detail behind a card or a number, shown on tap (phones) or hover and focus
// (desktop), never only on hover. Any element with data-tip="…" gets one; a tap on a link or a
// button inside it does what that control does instead. One tip at a time; Escape, a tap elsewhere
// or scrolling the page closes it. (These used to be title attributes: invisible on a phone.)
let box = null, owner = null, hoverTimer = 0, shownAt = 0;

const interactive = (el) => el.closest('a, button, input, select, textarea, label, summary, [data-leg]');

function place(el) {
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const left = Math.min(innerWidth - b.width - 8, Math.max(8, r.left + r.width / 2 - b.width / 2));
  const below = r.bottom + 8 + b.height < innerHeight;
  box.style.left = `${left}px`;
  box.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - b.height - 8)}px`;
}

export function showTip(el) {
  const text = el?.dataset.tip;
  if (!text) return;
  if (!box) {
    box = document.createElement('div');
    box.id = 'tip'; box.className = 'tip'; box.setAttribute('role', 'tooltip');
    document.body.appendChild(box);
  }
  if (owner && owner !== el) owner.removeAttribute('aria-describedby');
  owner = el;
  box.textContent = text; // plain text: lines split on \n by CSS (white-space: pre-line)
  box.hidden = false;
  shownAt = scrollY;
  el.setAttribute('aria-describedby', 'tip');
  place(el);
}
export function hideTip() {
  clearTimeout(hoverTimer);
  if (box) box.hidden = true;
  owner?.removeAttribute('aria-describedby');
  owner = null;
}

export function bindTips(root = document) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || interactive(e.target) !== interactive(el)) { if (!box?.contains(e.target)) hideTip(); return; }
    if (owner === el) hideTip(); else showTip(el);
  });
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  root.addEventListener('pointerover', (e) => {
    if (!fine.matches || e.pointerType !== 'mouse') return;
    const el = e.target.closest?.('[data-tip]');
    if (!el || el === owner) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showTip(el), 350);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) { clearTimeout(hoverTimer); if (owner === el) hideTip(); }
  });
  root.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-tip]')) showTip(e.target); });
  root.addEventListener('focusout', (e) => { if (e.target === owner) hideTip(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  // Closed by a real scroll, not by the page settling after the tap (smooth scrolling, momentum).
  addEventListener('scroll', () => { if (owner && Math.abs(scrollY - shownAt) > 60) hideTip(); }, { passive: true });
  addEventListener('hashchange', hideTip);
}
