// Small SVG/HTML chart builders. All return markup strings; animation comes from CSS (.grow, .draw).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const pc = (p, d = 1) => `${(p * 100).toFixed(p > 0 && p < 0.01 ? 2 : d)}%`;
export const odd = (o) => (Number.isFinite(o) ? (o >= 100 ? o.toFixed(0) : o.toFixed(2)) : '—');

// Horizontal stacked probability bar: [{label, p, color}]
export function probBar(parts) {
  return `<div class="pbar">${parts.map((x) => `<i class="grow" style="--w:${(x.p * 100).toFixed(2)}%;--c:${x.color}" title="${esc(x.label)} ${pc(x.p)}"></i>`).join('')}</div>`;
}

// Radial gauge for a single probability.
export function gauge(p, color, label) {
  const r = 52, c = 2 * Math.PI * r;
  return `<figure class="gauge"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="g-track"/>
    <circle cx="60" cy="60" r="${r}" class="g-val draw" style="--len:${c};--off:${c * (1 - p)};stroke:${color}"/></svg>
    <figcaption><b>${pc(p, 0)}</b><small>${esc(label)}</small></figcaption></figure>`;
}

// Correct-score heatmap from {size, cells:[{h,a,p}]}
export function heatmap(grid, home, away, color) {
  const n = grid.size + 1;
  const max = Math.max(...grid.cells.map((c) => c.p));
  const cell = (c) => `<i style="--a:${(0.08 + 0.92 * (c.p / max)).toFixed(3)};--c:${color}" title="${c.h}-${c.a} · ${pc(c.p)}"><span>${c.p >= 0.005 ? (c.p * 100).toFixed(c.p < 0.1 ? 1 : 0) : ''}</span></i>`;
  const head = Array.from({ length: n }, (_, j) => `<b>${j}</b>`).join('');
  let rows = '';
  for (let i = 0; i < n; i++) rows += `<b>${i}</b>${grid.cells.filter((c) => c.h === i).map(cell).join('')}`;
  return `<div class="heat" style="--n:${n}"><em class="hx">${esc(away)} →</em><em class="hy">${esc(home)} →</em><span></span>${head}${rows}</div>`;
}

// Distribution bars, e.g. points margin [{x, p}]
export function distBars(dist, colorPos, colorNeg) {
  const max = Math.max(...dist.map((d) => d.p));
  return `<div class="dist">${dist.map((d) => `<i class="grow-y" style="--h:${((d.p / max) * 100).toFixed(1)}%;--c:${d.x > 0 ? colorPos : d.x < 0 ? colorNeg : '#888'}" title="margin ${d.x > 0 ? '+' : ''}${d.x}: ${pc(d.p)}"></i>`).join('')}</div>
    <div class="dist-axis"><span>${dist[0].x}</span><span>0</span><span>+${dist[dist.length - 1].x}</span></div>`;
}

// W/D/L strip with a running points line.
export function formStrip(form) {
  if (!form?.length) return '<span class="muted">No recent form in feed</span>';
  return `<span class="form">${form.map((r) => `<i class="f-${r}">${r}</i>`).join('')}</span>`;
}

// Vertical bars for an outcome list [{name, p}]
export function outcomeBars(outcomes, color) {
  const max = Math.max(...outcomes.map((o) => o.p));
  return `<div class="obars">${outcomes.map((o) => `<div><i class="grow-y" style="--h:${((o.p / max) * 100).toFixed(1)}%;--c:${color}"></i><b>${pc(o.p, 0)}</b><small>${esc(o.name)}</small></div>`).join('')}</div>`;
}

// Probability vs price: shows fair, model and bookmaker implied on one track.
export function valueTrack(fairP, modelP, odds) {
  const implied = 1 / odds;
  const pos = (p) => `${Math.min(100, p * 100).toFixed(1)}%`;
  return `<div class="vtrack"><i class="vt-imp" style="left:${pos(implied)}" title="Price implies ${pc(implied)}"></i>
    <i class="vt-fair" style="left:${pos(fairP)}" title="Fair ${pc(fairP)}"></i>
    ${modelP != null ? `<i class="vt-model" style="left:${pos(modelP)}" title="Model ${pc(modelP)}"></i>` : ''}</div>`;
}
