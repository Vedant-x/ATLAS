// Each sport's own playing surface for the 3D background, in the same neon style as the F1 circuit:
// real markings (to scale) drawn as glowing lines on a canvas, plus the sport's 3D furniture (posts,
// hoops, nets, stumps, cage) and a ball that moves the way that sport's ball does.
// draw(ctx, W, H) paints the markings in white (the scene tints them with the sport colour); props
// are line segments in the venue's own units (x across the long side, y up, z across the short side,
// all scaled to ±1 on x); ball(t) returns where the ball is at time t.

const TAU = Math.PI * 2;
const fit = (W, H, L, B, pad = 0.06) => {
  // metres → canvas pixels for a field L × B, centred, keeping proportions
  const s = Math.min((W * (1 - 2 * pad)) / L, (H * (1 - 2 * pad)) / B);
  return { s, ox: W / 2 - (L * s) / 2, oy: H / 2 - (B * s) / 2, X: (x) => W / 2 - (L * s) / 2 + x * s, Y: (y) => H / 2 - (B * s) / 2 + y * s };
};
const line = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
const rect = (c, x, y, w, h) => c.strokeRect(x, y, w, h);
const circle = (c, x, y, r, a0 = 0, a1 = TAU) => { c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke(); };
const dot = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
const dashed = (c, pts, d = [10, 10]) => { c.setLineDash(d); line(c, pts); c.setLineDash([]); };

// ---------- markings ----------
function soccer(c, W, H, grid = false) {
  const L = 105, B = 68, f = fit(W, H, L, B), { X, Y, s } = f;
  if (grid) { c.save(); c.globalAlpha = 0.18; for (let x = 0; x <= L; x += 5) line(c, [[X(x), Y(0)], [X(x), Y(B)]]); for (let y = 0; y <= B; y += 5) line(c, [[X(0), Y(y)], [X(L), Y(y)]]); c.restore(); }
  rect(c, X(0), Y(0), L * s, B * s);
  line(c, [[X(L / 2), Y(0)], [X(L / 2), Y(B)]]);
  circle(c, X(L / 2), Y(B / 2), 9.15 * s); dot(c, X(L / 2), Y(B / 2), 4);
  for (const side of [0, 1]) {
    const x0 = side ? L - 16.5 : 0, g = side ? L - 5.5 : 0, spot = side ? L - 11 : 11;
    rect(c, X(x0), Y(B / 2 - 20.16), 16.5 * s, 40.32 * s);
    rect(c, X(g), Y(B / 2 - 9.16), 5.5 * s, 18.32 * s);
    dot(c, X(spot), Y(B / 2), 4);
    const a = Math.acos(5.5 / 9.15);
    circle(c, X(spot), Y(B / 2), 9.15 * s, side ? Math.PI - a : -a, side ? Math.PI + a : a);
    for (const cy of [0, B]) circle(c, X(side ? L : 0), Y(cy), 1 * s, 0, TAU);
  }
}
function gridiron(c, W, H) {
  const L = 120, B = 53.3, { X, Y, s } = fit(W, H, L, B);
  rect(c, X(0), Y(0), L * s, B * s);
  c.save(); c.globalAlpha = 0.22; c.fillStyle = '#fff'; c.fillRect(X(0), Y(0), 10 * s, B * s); c.fillRect(X(110), Y(0), 10 * s, B * s); c.restore();
  for (let x = 10; x <= 110; x += 5) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  for (let x = 11; x < 110; x++) if (x % 5) for (const y of [1, B - 1, B / 2 - 3.1, B / 2 + 3.1]) line(c, [[X(x), Y(y - 0.6)], [X(x), Y(y + 0.6)]]);
  c.font = `${Math.round(3.2 * s)}px Anton, Impact, sans-serif`; c.fillStyle = '#fff'; c.textAlign = 'center';
  for (let x = 20; x <= 100; x += 10) { const n = 50 - Math.abs(60 - x); c.fillText(String(n), X(x), Y(10)); c.fillText(String(n), X(x), Y(B - 7)); }
}
function basketball(c, W, H) {
  const L = 28.65, B = 15.24, { X, Y, s } = fit(W, H, L, B);
  rect(c, X(0), Y(0), L * s, B * s);
  line(c, [[X(L / 2), Y(0)], [X(L / 2), Y(B)]]);
  circle(c, X(L / 2), Y(B / 2), 1.83 * s);
  for (const side of [0, 1]) {
    const bx = side ? L - 1.6 : 1.6, dir = side ? -1 : 1;
    rect(c, X(side ? L - 5.79 : 0), Y(B / 2 - 2.44), 5.79 * s, 4.88 * s);
    circle(c, X(side ? L - 5.79 : 5.79), Y(B / 2), 1.83 * s);
    circle(c, X(bx), Y(B / 2), 0.23 * s);
    // three-point line: straight corners then the arc (7.24 m)
    const r = 7.24, cy = 0.91, ang = Math.asin((B / 2 - cy) / r), xa = bx + dir * r * Math.cos(ang);
    line(c, [[X(side ? L : 0), Y(cy)], [X(xa), Y(cy)]]);
    line(c, [[X(side ? L : 0), Y(B - cy)], [X(xa), Y(B - cy)]]);
    if (side) circle(c, X(bx), Y(B / 2), r * s, Math.PI - ang, Math.PI + ang); else circle(c, X(bx), Y(B / 2), r * s, -ang, ang);
  }
}
function baseball(c, W, H) {
  // home plate at the bottom centre, foul lines at ±45°, outfield fence ~ 120 m
  const R = 120, { X, Y, s } = fit(W, H, R * 1.5, R * 1.08), hx = R * 0.75, hy = R * 1.04;
  const P = (dx, dy) => [X(hx + dx), Y(hy - dy)];
  const d = 27.43 / Math.SQRT2;
  line(c, [P(0, 0), P(-R * 0.707, R * 0.707)]); line(c, [P(0, 0), P(R * 0.707, R * 0.707)]);
  c.beginPath(); c.arc(...P(0, 0), R * s, -Math.PI * 0.75, -Math.PI * 0.25); c.stroke();
  c.beginPath(); c.arc(...P(0, 0), 29 * s * 1.0, -Math.PI * 0.75, -Math.PI * 0.25); c.stroke();
  line(c, [P(0, 0), P(d, d), P(0, 2 * d), P(-d, d), P(0, 0)]);
  for (const [x, y] of [[d, d], [0, 2 * d], [-d, d]]) { const [px, py] = P(x, y); c.fillStyle = '#fff'; c.fillRect(px - 5, py - 5, 10, 10); }
  circle(c, ...P(0, 18.44), 2.7 * s); dot(c, ...P(0, 0), 5);
}
function hockey(c, W, H) {
  const L = 60.96, B = 25.9, r = 8.5, { X, Y, s } = fit(W, H, L, B);
  c.beginPath(); c.roundRect(X(0), Y(0), L * s, B * s, r * s); c.stroke();
  line(c, [[X(L / 2), Y(0)], [X(L / 2), Y(B)]]);
  for (const x of [L / 2 - 7.62, L / 2 + 7.62]) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  for (const x of [3.35, L - 3.35]) line(c, [[X(x), Y(1.2)], [X(x), Y(B - 1.2)]]);
  circle(c, X(L / 2), Y(B / 2), 4.57 * s);
  for (const x of [9.45, L - 9.45]) for (const y of [B / 2 - 6.71, B / 2 + 6.71]) { circle(c, X(x), Y(y), 4.57 * s); dot(c, X(x), Y(y), 4); }
  for (const x of [3.35, L - 3.35]) circle(c, X(x), Y(B / 2), 1.83 * s, x < L / 2 ? -Math.PI / 2 : Math.PI / 2, x < L / 2 ? Math.PI / 2 : Math.PI * 1.5);
}
function tennis(c, W, H) {
  const L = 23.77, B = 10.97, sb = 8.23, { X, Y, s } = fit(W, H, L, B, 0.12);
  rect(c, X(0), Y(0), L * s, B * s);
  const off = (B - sb) / 2;
  line(c, [[X(0), Y(off)], [X(L), Y(off)]]); line(c, [[X(0), Y(B - off)], [X(L), Y(B - off)]]);
  for (const x of [L / 2 - 6.4, L / 2 + 6.4]) line(c, [[X(x), Y(off)], [X(x), Y(B - off)]]);
  line(c, [[X(L / 2 - 6.4), Y(B / 2)], [X(L / 2 + 6.4), Y(B / 2)]]);
  c.save(); c.lineWidth *= 1.6; line(c, [[X(L / 2), Y(-0.9)], [X(L / 2), Y(B + 0.9)]]); c.restore();
  for (const x of [0, L]) line(c, [[X(x), Y(B / 2)], [X(x + (x ? -0.3 : 0.3)), Y(B / 2)]]);
}
function cricket(c, W, H) {
  const { X, Y, s } = fit(W, H, 150, 135);
  c.beginPath(); c.ellipse(X(75), Y(67.5), 74 * s, 66 * s, 0, 0, TAU); c.stroke();
  c.setLineDash([12, 10]); c.beginPath(); c.ellipse(X(75), Y(67.5), 27.4 * s, 27.4 * s, 0, 0, TAU); c.stroke(); c.setLineDash([]);
  c.save(); c.globalAlpha = 0.25; c.fillStyle = '#fff'; c.fillRect(X(75 - 1.5), Y(67.5 - 10.06), 3 * s, 20.12 * s); c.restore();
  rect(c, X(75 - 1.5), Y(67.5 - 10.06), 3 * s, 20.12 * s);
  for (const y of [67.5 - 10.06 + 1.22, 67.5 + 10.06 - 1.22]) line(c, [[X(75 - 2.64), Y(y)], [X(75 + 2.64), Y(y)]]);
}
function rugby(c, W, H) {
  const L = 120, B = 70, { X, Y, s } = fit(W, H, L, B);
  rect(c, X(0), Y(0), L * s, B * s);
  for (const x of [10, 110]) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  for (const x of [32, 88]) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  line(c, [[X(60), Y(0)], [X(60), Y(B)]]);
  for (const x of [50, 70]) dashed(c, [[X(x), Y(0)], [X(x), Y(B)]], [14, 12]);
  for (const x of [15, 105]) dashed(c, [[X(x), Y(5)], [X(x), Y(B - 5)]], [8, 14]);
  for (const y of [5, 15, B - 15, B - 5]) dashed(c, [[X(10), Y(y)], [X(110), Y(y)]], [6, 26]);
}
function aussie(c, W, H) {
  const { X, Y, s } = fit(W, H, 165, 135);
  c.beginPath(); c.ellipse(X(82.5), Y(67.5), 82 * s, 66 * s, 0, 0, TAU); c.stroke();
  rect(c, X(82.5 - 25), Y(67.5 - 25), 50 * s, 50 * s);
  circle(c, X(82.5), Y(67.5), 5 * s); circle(c, X(82.5), Y(67.5), 1.5 * s);
  for (const [x, a0, a1] of [[0.5, -Math.PI / 2.6, Math.PI / 2.6], [164.5, Math.PI - Math.PI / 2.6, Math.PI + Math.PI / 2.6]]) circle(c, X(x), Y(67.5), 50 * s, a0, a1);
  for (const x of [0.5, 164.5 - 9]) rect(c, X(x), Y(67.5 - 3.2), 9 * s, 6.4 * s);
}
function octagon(c, W, H) {
  const cx = W / 2, cy = H / 2, R = H * 0.44;
  const pts = Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * TAU + Math.PI / 8; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  line(c, pts); line(c, pts.map(([x, y]) => [cx + (x - cx) * 0.93, cy + (y - cy) * 0.93]));
  circle(c, cx, cy, R * 0.18);
  c.font = `${Math.round(H * 0.08)}px Anton, Impact, sans-serif`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.globalAlpha = 0.5; c.fillText('ATLAS', cx, cy + H * 0.03); c.globalAlpha = 1;
}
function volleyball(c, W, H) {
  const L = 18, B = 9, { X, Y, s } = fit(W, H, L, B, 0.14);
  rect(c, X(0), Y(0), L * s, B * s);
  c.save(); c.lineWidth *= 1.6; line(c, [[X(9), Y(-0.8)], [X(9), Y(B + 0.8)]]); c.restore();
  for (const x of [6, 12]) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  for (const x of [6, 12]) dashed(c, [[X(x), Y(-0.6)], [X(x), Y(0)]], [4, 4]);
}
function lacrosse(c, W, H) {
  const L = 100, B = 55, { X, Y, s } = fit(W, H, L, B);
  rect(c, X(0), Y(0), L * s, B * s);
  line(c, [[X(50), Y(0)], [X(50), Y(B)]]);
  for (const x of [35, 65]) line(c, [[X(x), Y(0)], [X(x), Y(B)]]);
  rect(c, X(50 - 9), Y(B / 2 - 9), 18 * s, 18 * s);
  for (const x of [13, 87]) circle(c, X(x), Y(B / 2), 2.74 * s);
  for (const x of [0, 78]) rect(c, X(x), Y(B / 2 - 18), 22 * s, 36 * s);
}
function arena(c, W, H) {
  // Esports: a stage with a hex grid floor and two team zones.
  c.save(); c.globalAlpha = 0.35;
  const r = H / 16;
  for (let y = 0, row = 0; y < H + r; y += r * 1.5, row++) for (let x = (row % 2) * r * 0.866; x < W + r; x += r * 1.732) {
    c.beginPath(); for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + (i * TAU) / 6; const px = x + r * 0.95 * Math.cos(a), py = y + r * 0.95 * Math.sin(a); i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke();
  }
  c.restore();
  c.save(); c.lineWidth *= 2; rect(c, W * 0.06, H * 0.12, W * 0.88, H * 0.76); c.restore();
  for (const x of [W * 0.2, W * 0.8]) { circle(c, x, H / 2, H * 0.17); circle(c, x, H / 2, H * 0.06); }
  line(c, [[W / 2, H * 0.12], [W / 2, H * 0.88]]);
}

// ---------- 3D furniture (segments in venue units: x ±1 along the long side, z across, y up) ----------
const goal = (x, w, h, d) => { const s = Math.sign(x) || 1; return [[x, 0, -w], [x, h, -w], [x, h, -w], [x, h, w], [x, h, w], [x, 0, w], [x, h, -w], [x + s * d, 0, -w], [x, h, w], [x + s * d, 0, w], [x + s * d, 0, -w], [x + s * d, 0, w]]; };
const hPost = (x, w, bar, h) => [[x, 0, -w], [x, h, -w], [x, 0, w], [x, h, w], [x, bar, -w], [x, bar, w]];
const net = (w, h) => [[0, 0, -w], [0, h, -w], [0, 0, w], [0, h, w], [0, h, -w], [0, h, w], [0, h * 0.55, -w], [0, h * 0.55, w]];
const hoop = (x) => { const out = [[x, 0, 0], [x, 0.32, 0], [x, 0.32, -0.05], [x, 0.32, 0.05]]; const s = -Math.sign(x), cx = x + s * 0.035; for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, b = ((i + 1) / 12) * TAU; out.push([cx + 0.03 * Math.cos(a), 0.28, 0.03 * Math.sin(a)], [cx + 0.03 * Math.cos(b), 0.28, 0.03 * Math.sin(b)]); } return out; };
const cage = (r, h) => { const out = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8, b = ((i + 1) / 8) * TAU + Math.PI / 8; const p = [r * Math.cos(a), r * Math.sin(a)], q = [r * Math.cos(b), r * Math.sin(b)]; out.push([p[0], 0, p[1]], [p[0], h, p[1]], [p[0], h, p[1]], [q[0], h, q[1]], [p[0], h * 0.5, p[1]], [q[0], h * 0.5, q[1]]); } return out; };
const stumps = (x) => [-0.012, 0, 0.012].flatMap((z) => [[x, 0, z], [x, 0.05, z]]);

// ---------- ball paths ----------
const lerp = (a, b, k) => a + (b - a) * k;
const bounce = (k) => Math.abs(Math.sin(k * Math.PI));

export const VENUES = {
  football: { draw: (c, W, H) => soccer(c, W, H), aspect: 1.54, props: [...goal(-1, 0.11, 0.04, 0.03), ...goal(1, 0.11, 0.04, 0.03)], ball: (t) => [0.8 * Math.sin(t * 0.37) * Math.cos(t * 0.11), 0.01 + 0.05 * bounce(t * 0.5), 0.5 * Math.sin(t * 0.53)] },
  efootball: { draw: (c, W, H) => soccer(c, W, H, true), aspect: 1.54, props: [...goal(-1, 0.11, 0.04, 0.03), ...goal(1, 0.11, 0.04, 0.03)], ball: (t) => [0.9 * Math.sin(t * 0.9), 0.01, 0.5 * Math.sin(t * 1.3)] },
  americanfootball: { draw: gridiron, aspect: 2.25, props: [...hPost(-1, 0.05, 0.08, 0.25), ...hPost(1, 0.05, 0.08, 0.25)], ball: (t) => { const k = (t * 0.25) % 1; return [lerp(-0.6, 0.7, k), 0.25 * bounce(k), 0.15 * Math.sin(t)]; } },
  basketball: { draw: basketball, aspect: 1.88, props: [...hoop(-0.89), ...hoop(0.89)], ball: (t) => { const k = (t * 0.2) % 1, x = Math.sin(k * TAU) * 0.75; return [x, 0.02 + 0.12 * bounce(t * 1.6), 0.25 * Math.sin(t * 0.7)]; } },
  baseball: { draw: baseball, aspect: 1.39, props: [], ball: (t) => { const k = (t * 0.3) % 1; return k < 0.3 ? [0, 0.02, lerp(-0.12, -0.55, k / 0.3)] : [lerp(0, 0.45, (k - 0.3) / 0.7), 0.45 * bounce((k - 0.3) / 0.7), lerp(-0.55, 0.35, (k - 0.3) / 0.7)]; } },
  hockey: { draw: hockey, aspect: 2.35, props: [...goal(-0.89, 0.04, 0.03, 0.03), ...goal(0.89, 0.04, 0.03, 0.03)], ball: (t) => [0.8 * Math.sin(t * 0.6), 0.004, 0.32 * Math.sin(t * 1.1)] },
  tennis: { draw: tennis, aspect: 2.0, props: net(0.55, 0.06).map(([x, y, z]) => [x, y, z]), ball: (t) => { const k = (t * 0.45) % 2, d = k < 1 ? k : 2 - k; return [lerp(-0.75, 0.75, d), 0.02 + 0.14 * bounce(k), 0.2 * Math.sin(t * 0.8)]; } },
  cricket: { draw: cricket, aspect: 1.11, props: [...stumps(-0.135), ...stumps(0.135)].map(([x, y, z]) => [z, y, x]), ball: (t) => { const k = (t * 0.35) % 1; return [0.01, 0.03 + 0.05 * bounce(k * 1.4), lerp(0.13, -0.13, k)]; } },
  rugby: { draw: rugby, aspect: 1.71, props: [...hPost(-0.83, 0.05, 0.05, 0.3), ...hPost(0.83, 0.05, 0.05, 0.3)], ball: (t) => [0.7 * Math.sin(t * 0.3), 0.01 + 0.08 * bounce(t * 0.4), 0.4 * Math.sin(t * 0.5)] },
  aussierules: { draw: aussie, aspect: 1.22, props: [...hPost(-0.99, 0.02, 0, 0.3), ...hPost(-0.99, 0.06, 0, 0.15), ...hPost(0.99, 0.02, 0, 0.3), ...hPost(0.99, 0.06, 0, 0.15)], ball: (t) => [0.75 * Math.sin(t * 0.35), 0.02 + 0.2 * bounce(t * 0.3), 0.5 * Math.sin(t * 0.45)] },
  mma: { draw: octagon, aspect: 1.6, props: cage(0.56, 0.18), ball: null },
  volleyball: { draw: volleyball, aspect: 1.75, props: net(0.6, 0.12), ball: (t) => { const k = (t * 0.4) % 2, d = k < 1 ? k : 2 - k; return [lerp(-0.6, 0.6, d), 0.05 + 0.3 * bounce(k), 0.2 * Math.sin(t)]; } },
  lacrosse: { draw: lacrosse, aspect: 1.82, props: [...goal(-0.74, 0.02, 0.02, 0.02), ...goal(0.74, 0.02, 0.02, 0.02)], ball: (t) => [0.7 * Math.sin(t * 0.5), 0.02 + 0.1 * bounce(t * 0.7), 0.35 * Math.sin(t * 0.8)] },
  esports: { draw: arena, aspect: 1.6, props: [], ball: (t) => [0.6 * Math.sin(t * 0.8), 0.04, 0.3 * Math.sin(t * 1.6)] },
};
