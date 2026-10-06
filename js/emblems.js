// Page emblems for the 3D background: one object per page that says what the page is about, drawn
// in the same neon-line style as the sport venues (glowing edges, faint fills, additive light).
//   balls    Today / Explore: football, basketball, tennis ball and baseball floating together
//   digits   Multipliers / Target / Mega: the multiplier itself as a 3D number ("2×", "7.5×", "1000×")
//   target   Target before a number is entered: a bullseye with a dart flying in
//   coins    Bankers: stacks of coins
//   bars     Edge board: a price ladder of rising bars
//   trophy   Track record
//   radar    Live: a sweep finding live matches
//   star     Watchlist
//   scale    Compare: a balance weighing two sides
//   duel     Match pages: two columns in team colours, as tall as each side's win chance
// build(THREE, kind, value) → Group with userData.tick(t, dt) and userData.tint(color[, colorB]).

const TAU = Math.PI * 2;

export function buildEmblem(THREE, kind, value) {
  const g = new THREE.Group();
  const tinted = [], tintedB = [];
  const lineMat = (o = 0.95, b = false) => { const m = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }); (b ? tintedB : tinted).push(m); return m; };
  const fillMat = (o = 0.16, b = false) => { const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); (b ? tintedB : tinted).push(m); return m; };
  const white = (o = 0.9) => new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  // A solid as glowing edges over a faint fill.
  const solid = (geo, { edge = 0.95, fill = 0.14, b = false, angle = 20 } = {}) => {
    const grp = new THREE.Group();
    if (fill) grp.add(new THREE.Mesh(geo, fillMat(fill, b)));
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), lineMat(edge, b)));
    return grp;
  };
  const curve = (pts, mat, closed = true) => {
    const geo = new THREE.BufferGeometry().setFromPoints(closed ? [...pts, pts[0]] : pts);
    return new THREE.Line(geo, mat);
  };
  const ring = (r, n = 96, y = 0) => Array.from({ length: n }, (_, i) => new THREE.Vector3(Math.cos((i / n) * TAU) * r, y, Math.sin((i / n) * TAU) * r));
  let tick = () => {};

  if (kind === 'balls') {
    // Football (geodesic panels), basketball (seams), tennis ball (one curved seam), baseball (stitched seam).
    const make = (type) => {
      const b = new THREE.Group();
      if (type === 'football') b.add(solid(new THREE.IcosahedronGeometry(1, 1), { fill: 0.1, angle: 1 }));
      else {
        b.add(new THREE.Mesh(new THREE.SphereGeometry(0.98, 32, 20), fillMat(0.1)));
        b.add(curve(ring(1, 96), lineMat(0.35)));
      }
      if (type === 'basketball') {
        b.add(curve(ring(1.005, 96), lineMat(0.9)));
        const m = curve(ring(1.005, 96), lineMat(0.9)); m.rotation.z = Math.PI / 2; b.add(m);
        for (const s of [-1, 1]) { const c = curve(ring(0.8, 80), lineMat(0.9)); c.rotation.z = Math.PI / 2; c.position.x = s * 0.6; c.scale.set(1, 1.0, 1); b.add(c); }
      }
      if (type === 'tennis' || type === 'baseball') {
        // The classic two-lobed seam on a sphere.
        const seam = Array.from({ length: 160 }, (_, i) => {
          const u = (i / 160) * TAU, a = 0.44;
          const x = Math.cos(u) * (1 - a) + a * Math.cos(3 * u), y = Math.sin(u) * (1 - a) - a * Math.sin(3 * u), z = 2 * Math.sqrt(a * (1 - a)) * Math.sin(2 * u);
          return new THREE.Vector3(x, y, z).normalize().multiplyScalar(1.01);
        });
        b.add(curve(seam, lineMat(0.95)));
        if (type === 'baseball') {
          const pos = [];
          seam.forEach((p, i) => { if (i % 5) return; const n = seam[(i + 1) % seam.length].clone().sub(p).normalize(), side = p.clone().cross(n).normalize().multiplyScalar(0.06); pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z); });
          const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          b.add(new THREE.LineSegments(sg, white(0.8)));
        }
      }
      return b;
    };
    const balls = [['football', -1.25, 0.55, 1.05], ['basketball', 1.15, 0.85, 0.85], ['tennis', -0.95, -1.3, 0.6], ['baseball', 1.05, -1.05, 0.68]].map(([type, x, y, s], i) => {
      const b = make(type); b.position.set(x, y, (i % 2) * 0.4 - 0.2); b.scale.setScalar(s); b.userData = { y, ph: i * 1.7, spin: 0.25 + i * 0.07 }; g.add(b); return b;
    });
    tick = (t, dt) => balls.forEach((b) => { b.position.y = b.userData.y + Math.sin(t * 0.8 + b.userData.ph) * 0.12; b.rotation.y += dt * b.userData.spin; b.rotation.x += dt * b.userData.spin * 0.4; });
  }

  if (kind === 'digits') {
    // Seven-segment numerals: the multiplier you are looking at, in 3D.
    const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
    const P = { a: [0, 1, 1], b: [0.5, 0.5, 0], c: [0.5, -0.5, 0], d: [0, -1, 1], e: [-0.5, -0.5, 0], f: [-0.5, 0.5, 0], g: [0, 0, 1] };
    const hGeo = new THREE.BoxGeometry(0.78, 0.15, 0.22), vGeo = new THREE.BoxGeometry(0.15, 0.78, 0.22);
    const text = String(value ?? '').replace(/x$/i, '×').slice(0, 8);
    const chars = new THREE.Group();
    let x = 0;
    for (const ch of text) {
      const c = new THREE.Group();
      if (SEG[ch]) { for (const s of SEG[ch]) { const [px, py, h] = P[s]; const m = solid(h ? hGeo : vGeo, { fill: 0.22 }); m.position.set(px, py, 0); c.add(m); } c.position.x = x + 0.5; x += 1.4; }
      else if (ch === '.') { const m = solid(new THREE.BoxGeometry(0.2, 0.2, 0.22), { fill: 0.3 }); m.position.set(0.1, -1, 0); c.add(m); c.position.x = x; x += 0.55; }
      else if (ch === '×' || ch === '+') {
        for (const r of ch === '×' ? [Math.PI / 4, -Math.PI / 4] : [0, Math.PI / 2]) { const m = solid(new THREE.BoxGeometry(0.95, 0.15, 0.22), { fill: 0.3 }); m.rotation.z = r; c.add(m); }
        c.position.set(x + 0.55, -0.15, 0); c.scale.setScalar(0.8); x += 1.3;
      } else continue;
      chars.add(c);
    }
    chars.position.x = -x / 2 + 0.2;
    g.add(chars);
    chars.children.forEach((c, i) => { c.userData.ph = i * 0.6; });
    tick = (t) => { chars.children.forEach((c) => { c.position.y = Math.sin(t * 1.1 + c.userData.ph) * 0.06; }); g.rotation.y = Math.sin(t * 0.35) * 0.35; };
  }

  if (kind === 'target') {
    const board = new THREE.Group();
    [1.9, 1.5, 1.1, 0.7, 0.3].forEach((r, i) => {
      board.add(curve(ring(r, 120).map((p) => new THREE.Vector3(p.x, p.z, 0)), lineMat(0.95 - i * 0.05)));
      const disc = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r - 0.4), r, 64), fillMat(i % 2 ? 0.05 : 0.14)); board.add(disc);
    });
    const cross = new THREE.BufferGeometry(); cross.setAttribute('position', new THREE.Float32BufferAttribute([-2.2, 0, 0, 2.2, 0, 0, 0, -2.2, 0, 0, 2.2, 0], 3));
    board.add(new THREE.LineSegments(cross, lineMat(0.25)));
    g.add(board);
    // The dart: a shaft with flights, flying in and sticking near the centre.
    const dart = new THREE.Group();
    const shaft = new THREE.BufferGeometry(); shaft.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1.6, 0, 0, 1.6, 0.18, 0, 1.95, 0, 0, 1.6, -0.18, 0, 1.95, 0, 0, 1.6, 0, 0.18, 1.95, 0, 0, 1.6, 0, -0.18, 1.95], 3));
    dart.add(new THREE.LineSegments(shaft, white(0.95)));
    g.add(dart);
    tick = (t) => {
      const k = (t * 0.25) % 1, fly = Math.min(1, k / 0.25);
      const e = 1 - (1 - fly) ** 3;
      dart.position.set(0.25 + (1 - e) * 2.5, 0.2 + (1 - e) * 1.4, (1 - e) * 6);
      dart.rotation.set(-0.15, 0.25, 0);
      board.rotation.z = fly >= 1 && k < 0.3 ? Math.sin((k - 0.25) * 120) * 0.02 : 0; // a small wobble on impact
      g.rotation.y = Math.sin(t * 0.3) * 0.25;
    };
  }

  if (kind === 'coins') {
    const coin = new THREE.CylinderGeometry(0.62, 0.62, 0.13, 40);
    const stacks = [[-1.2, 5], [0, 8], [1.2, 6]].map(([x, n]) => {
      const s = new THREE.Group();
      for (let i = 0; i < n; i++) { const c = solid(coin, { fill: 0.12, angle: 30 }); c.position.y = -1.6 + i * 0.15; c.rotation.y = i * 0.3; s.add(c); }
      s.position.x = x; g.add(s); return s;
    });
    const top = solid(coin, { fill: 0.3, angle: 30 }); g.add(top);
    tick = (t) => { stacks.forEach((s, i) => { s.rotation.y = t * (0.15 + i * 0.05); }); const k = (t * 0.3) % 1; top.position.set(0, 1.4 - Math.min(1, k * 1.6) * 1.75, 0); top.rotation.x = Math.max(0, 1 - k * 1.6) * 6; top.visible = k < 0.85; };
  }

  if (kind === 'bars') {
    const n = 7, bars = [];
    for (let i = 0; i < n; i++) {
      const b = solid(new THREE.BoxGeometry(0.42, 1, 0.42), { fill: 0.18 });
      b.position.x = (i - (n - 1) / 2) * 0.62; b.userData.ph = i * 0.9; g.add(b); bars.push(b);
    }
    const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute([-2.4, -1.6, 0, 2.4, -1.6, 0], 3));
    g.add(new THREE.LineSegments(base, lineMat(0.5)));
    tick = (t) => bars.forEach((b, i) => { const h = 0.6 + i * 0.32 + Math.sin(t * 1.2 + b.userData.ph) * 0.35; b.scale.y = h; b.position.y = -1.6 + h / 2; });
  }

  if (kind === 'trophy') {
    const prof = [[0, -1.9], [0.95, -1.9], [0.95, -1.7], [0.45, -1.55], [0.22, -1.2], [0.2, -0.55], [0.55, -0.3], [1.05, 0.25], [1.2, 1.25], [1.25, 1.45], [0, 1.45]].map(([x, y]) => new THREE.Vector2(x, y));
    const cup = solid(new THREE.LatheGeometry(prof, 28), { fill: 0.14, angle: 25 });
    g.add(cup);
    for (const s of [-1, 1]) { const h = curve(Array.from({ length: 30 }, (_, i) => { const a = -Math.PI / 2 + (i / 29) * Math.PI; return new THREE.Vector3(s * (1.15 + Math.cos(a) * 0.55), 0.75 + Math.sin(a) * 0.5, 0); }), lineMat(0.9), false); g.add(h); }
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    star.scale.setScalar(0.3); star.position.set(0.7, 1.2, 0.6); g.add(star);
    tick = (t) => { g.rotation.y = t * 0.35; star.material.opacity = Math.max(0, Math.sin(t * 1.3)) ** 6; };
  }

  if (kind === 'radar') {
    const disc = new THREE.Group();
    [0.6, 1.2, 1.8].forEach((r) => disc.add(curve(ring(r, 96), lineMat(0.55))));
    const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute([-1.9, 0, 0, 1.9, 0, 0, 0, 0, -1.9, 0, 0, 1.9], 3));
    disc.add(new THREE.LineSegments(grid, lineMat(0.3)));
    const sweep = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32, 0, 0.6), fillMat(0.35)); sweep.rotation.x = -Math.PI / 2; disc.add(sweep);
    const blips = Array.from({ length: 6 }, (_, i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), fillMat(0.9)); const a = i * 1.9, r = 0.5 + (i % 3) * 0.5; b.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r); b.userData.a = ((-a % TAU) + TAU) % TAU; disc.add(b); return b; });
    disc.rotation.x = 1.15; g.add(disc); // tipped toward the viewer so the sweep reads as a radar screen
    tick = (t) => {
      const ang = (t * 1.2) % TAU; sweep.rotation.z = ang;
      blips.forEach((b) => { const d = ((ang - b.userData.a) % TAU + TAU) % TAU; b.material.opacity = Math.max(0.15, 1 - d / 3); b.scale.setScalar(1 + Math.max(0, 0.6 - d) * 1.5); });
    };
  }

  if (kind === 'star') {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.8 : 1.9, a = Math.PI / 2 + (i / 10) * TAU; (i ? sh.lineTo : sh.moveTo).call(sh, Math.cos(a) * r, Math.sin(a) * r); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
    geo.center();
    const s = solid(geo, { fill: 0.18, angle: 25 }); g.add(s);
    tick = (t) => { s.rotation.y = Math.sin(t * 0.6) * 0.6; s.position.y = Math.sin(t * 0.9) * 0.1; };
  }

  if (kind === 'scale') {
    const post = new THREE.BufferGeometry(); post.setAttribute('position', new THREE.Float32BufferAttribute([0, -1.9, 0, 0, 1.1, 0, -0.7, -1.9, 0, 0.7, -1.9, 0], 3));
    g.add(new THREE.LineSegments(post, lineMat(0.9)));
    const arm = new THREE.Group(); arm.position.y = 1.1; g.add(arm);
    const bar = new THREE.BufferGeometry(); bar.setAttribute('position', new THREE.Float32BufferAttribute([-1.8, 0, 0, 1.8, 0, 0], 3));
    arm.add(new THREE.LineSegments(bar, lineMat(0.95)));
    const pans = [-1.8, 1.8].map((x, i) => {
      const p = new THREE.Group(); p.position.x = x;
      const strings = new THREE.BufferGeometry(); strings.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.55, -1.1, 0, 0, 0, 0, 0.55, -1.1, 0], 3));
      p.add(new THREE.LineSegments(strings, lineMat(0.6, i === 1)));
      const dish = curve(ring(0.6, 48, -1.1), lineMat(0.95, i === 1)); p.add(dish);
      const pan = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), fillMat(0.2, i === 1)); pan.position.y = -1.1; pan.rotation.x = -Math.PI / 2; p.add(pan);
      arm.add(p); return p;
    });
    tick = (t) => { const a = Math.sin(t * 0.7) * 0.18; arm.rotation.z = a; pans.forEach((p) => { p.rotation.z = -a; }); g.rotation.y = Math.sin(t * 0.3) * 0.4; };
  }

  if (kind === 'duel') {
    // value: { pHome, pAway }: two columns whose heights are the win chances.
    const ph = value?.pHome ?? 0.5, pa = value?.pAway ?? 0.5, max = Math.max(ph, pa, 0.01);
    const cols = [[ph, -1.15, false], [pa, 1.15, true]].map(([p, x, b]) => {
      const h = 0.5 + (p / max) * 3.1;
      const c = solid(new THREE.BoxGeometry(1.1, h, 1.1), { fill: 0.2, b });
      c.position.set(x, -1.9 + h / 2, 0); c.userData = { h }; g.add(c);
      const cap = curve(ring(0.75, 48, 0), lineMat(0.8, b)); cap.position.set(x, -1.9 + h + 0.25, 0); g.add(cap); c.userData.cap = cap;
      return c;
    });
    const floor = new THREE.BufferGeometry(); floor.setAttribute('position', new THREE.Float32BufferAttribute([-2.4, -1.9, 0, 2.4, -1.9, 0], 3));
    g.add(new THREE.LineSegments(floor, white(0.4)));
    tick = (t) => { g.rotation.y = Math.sin(t * 0.3) * 0.5; cols.forEach((c, i) => { c.userData.cap.rotation.y = t * (i ? -1 : 1); c.userData.cap.position.y = -1.9 + c.userData.h + 0.25 + Math.sin(t * 1.4 + i) * 0.08; }); };
  }

  // Fit every emblem into the same footprint (about the size the old core had).
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  while (g.children.length) inner.add(g.children[0]);
  const fitScale = 4 / Math.max(size.x, size.y, 0.01);
  inner.position.copy(centre.multiplyScalar(-fitScale)); inner.scale.setScalar(fitScale);
  g.add(inner);
  const prevTick = tick;
  g.userData = {
    kind, value: JSON.stringify(value ?? null),
    tick: (t, dt) => prevTick(t, dt),
    tint(a, b = a, k = 0.05) { tinted.forEach((m) => m.color.lerp(a, k)); tintedB.forEach((m) => m.color.lerp(b, k)); },
    setOpacity(f) { g.traverse((o) => { if (o.material) { o.material.userData.base ??= o.material.opacity; o.material.opacity = o.material.userData.base * f; } }); },
    dispose() { g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); },
  };
  return g;
}

// Which emblem a page shows when it does not ask for one itself.
export const EMBLEM_FOR_MODE = { home: 'balls', sport: 'balls', bankers: 'coins', edge: 'bars', mega: 'digits', x: 'digits', match: 'duel', other: null, race: null };
