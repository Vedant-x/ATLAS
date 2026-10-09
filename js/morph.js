// Bring `el` in line with a new fragment, touching only the nodes that differ. A live refresh then
// changes the few rows whose score or price moved instead of rebuilding the page, which is what
// made scrolling stutter while matches were in play.
// A price, chance or score that just changed glows briefly, so a live update is noticed.
const FLASH = 'button.leg, .mini-nums b, .pp-p, .scoreline b, [data-flash]';
function flash(el) {
  const host = el?.closest?.(FLASH);
  if (!host) return;
  host.classList.remove('flash'); void host.offsetWidth; host.classList.add('flash');
  setTimeout(() => host.classList.remove('flash'), 1300);
}

export function morph(el, frag) {
  const a = [...el.childNodes], b = [...frag.childNodes];
  b.forEach((n, i) => {
    const o = a[i];
    if (!o) el.append(n);
    else if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) o.replaceWith(n);
    else if (n.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) { o.nodeValue = n.nodeValue; flash(o.parentElement); } }
    else if (!o.isEqualNode(n)) {
      for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
      for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
      if (o.nodeName === 'DETAILS' && o.open !== n.open) o.open = n.open;
      morph(o, n);
    }
  });
  for (let i = b.length; i < a.length; i++) a[i].remove();
}
