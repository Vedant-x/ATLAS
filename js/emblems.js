// Page emblems for the 3D background: one solid, lit object per page that says what the page is
// about. Physically based materials (metal, leather, felt, glass) lit by a studio environment, so
// they read as real objects rather than wireframes.
//   balls    Today / Explore: football, basketball, tennis ball and baseball
//   digits   Multipliers / Target / Mega: the multiplier on a glass display ("2×", "7.5×", "1000×")
//   target   Target before a number is entered: a dartboard with a dart flying in
//   coins    Bankers: stacks of gold coins, one flipping onto the pile
//   bars     Edge board: a price ladder of glossy bars
//   trophy   Track record: a gold cup on a black plinth
//   radar    Live: a radar screen sweeping for live matches
//   star     Watchlist: a bevelled gold star
//   scale    Compare: a brass balance
//   duel     Match pages: two columns in team colours, as tall as each side's win chance
// build(THREE, kind, value) → Group with userData.tick(t, dt), tint(colorA[, colorB]), setOpacity(f), dispose().

const TAU = Math.PI * 2;

// Small seeded noise so procedural textures are the same on every visit.
function rng(seed = 7) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function canvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null; // Node (tests): textures are skipped, geometry still builds
  c.width = w; c.height = h; return c;
}

export function buildEmblem(THREE, kind, value) {
  const g = new THREE.Group();
  const tinted = [], tintedB = [];
  const tex = (c) => { if (!c) return null; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  // Materials. "Accent" materials follow the page colour (team colours on a match).
  const gold = () => phys({ color: '#e7b647', metalness: 1, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const brass = () => phys({ color: '#c9a04f', metalness: 1, roughness: 0.32 });
  const chrome = () => phys({ color: '#dfe3ea', metalness: 1, roughness: 0.1 });
  const blackGloss = () => phys({ color: '#0d0e12', metalness: 0.2, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const accent = (b = false, o = {}) => { const m = phys({ color: '#ffffff', metalness: 0.55, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.18, ...o }); (b ? tintedB : tinted).push(m); return m; };
  const glow = (b = false, o = 0.9) => { const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }); (b ? tintedB : tinted).push(m); return m; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  // A rounded rectangle extruded with a soft bevel: the basic "machined" block.
  const rounded = (w, h, d, r = 0.06, bevel = 0.025) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2, rr = Math.min(r, w / 2, h / 2);
    s.moveTo(x + rr, y); s.lineTo(x + w - rr, y); s.quadraticCurveTo(x + w, y, x + w, y + rr); s.lineTo(x + w, y + h - rr); s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    s.lineTo(x + rr, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rr); s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
    geo.translate(0, 0, -d / 2); return geo;
  };
  // The two-lobed seam of a tennis ball or baseball.
  const seamCurve = (r = 1.005) => new THREE.CatmullRomCurve3(Array.from({ length: 120 }, (_, i) => {
    const u = (i / 120) * TAU, a = 0.44;
    return new THREE.Vector3(Math.cos(u) * (1 - a) + a * Math.cos(3 * u), Math.sin(u) * (1 - a) - a * Math.sin(3 * u), 2 * Math.sqrt(a * (1 - a)) * Math.sin(2 * u)).normalize().multiplyScalar(r);
  }), true);
  let tick = () => {};

  if (kind === 'balls') {
    // Football: the classic 12 black pentagons on white, as vertex colours on a fine sphere.
    const foot = (() => {
      const geo = new THREE.IcosahedronGeometry(1, 12);
      const phi = (1 + Math.sqrt(5)) / 2;
      const ico = [[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]].map((v) => new THREE.Vector3(...v).normalize());
      const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const d = Math.min(...ico.map((p) => v.angleTo(p)));
        const k = 1 - Math.min(1, Math.max(0, (d - 0.3) / 0.025)); // 1 inside a pentagon, sharp edge
        const seam = Math.abs(d - 0.555) < 0.01 ? 0.75 : 1; // faint stitch ring between panels
        const c = (1 - k) * 0.93 * seam + k * 0.05;
        col.set([c, c, c], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return mesh(geo, phys({ vertexColors: true, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.25 }));
    })();
    // Basketball: pebbled orange leather with black channels.
    const basket = (() => {
      const c = canvas(1024, 512), b = canvas(512, 256);
      if (c) {
        const x = c.getContext('2d'); x.fillStyle = '#c8561b'; x.fillRect(0, 0, 1024, 512);
        const r = rng(3); for (let i = 0; i < 26000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '90,30,5' : '255,170,110'},${0.08 + r() * 0.12})`; x.fillRect(r() * 1024, r() * 512, 2, 2); }
        x.strokeStyle = '#140904'; x.lineWidth = 9; x.lineCap = 'round';
        x.beginPath(); x.moveTo(0, 256); x.lineTo(1024, 256); x.stroke();
        for (const u of [256, 768]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, 512); x.stroke(); }
        for (const u of [0, 512, 1024]) { x.beginPath(); for (let v = 0; v <= 512; v += 4) { const off = 150 * Math.sin((v / 512) * Math.PI); x.lineTo(u - off, v); } x.stroke(); x.beginPath(); for (let v = 0; v <= 512; v += 4) { const off = 150 * Math.sin((v / 512) * Math.PI); x.lineTo(u + off, v); } x.stroke(); }
        const y = b.getContext('2d'); y.fillStyle = '#808080'; y.fillRect(0, 0, 512, 256); const r2 = rng(5); for (let i = 0; i < 30000; i++) { const s = r2(); y.fillStyle = `rgb(${s * 255},${s * 255},${s * 255})`; y.fillRect(r2() * 512, r2() * 256, 1.5, 1.5); }
      }
      return mesh(new THREE.SphereGeometry(1, 64, 48), phys({ map: tex(c), bumpMap: tex(b), bumpScale: 0.6, roughness: 0.72, color: c ? '#ffffff' : '#c8561b' }));
    })();
    // Tennis ball: optic-yellow felt with a white rubber seam.
    const tennis = (() => {
      const grp = new THREE.Group(), c = canvas(512, 256);
      if (c) { const x = c.getContext('2d'); x.fillStyle = '#cfe43c'; x.fillRect(0, 0, 512, 256); const r = rng(9); for (let i = 0; i < 20000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,200' : '120,140,20'},${0.1 + r() * 0.15})`; x.fillRect(r() * 512, r() * 256, 1.5, 1.5); } }
      grp.add(mesh(new THREE.SphereGeometry(1, 56, 40), phys({ map: tex(c), color: c ? '#ffffff' : '#cfe43c', roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color('#f4ffb0') })));
      grp.add(mesh(new THREE.TubeGeometry(seamCurve(1.0), 260, 0.035, 8, true), phys({ color: '#f4f4ee', roughness: 0.6 })));
      return grp;
    })();
    // Baseball: white leather, red double stitching along the seam.
    const base = (() => {
      const grp = new THREE.Group();
      grp.add(mesh(new THREE.SphereGeometry(1, 56, 40), phys({ color: '#f2ede2', roughness: 0.55, clearcoat: 0.2 })));
      const curve = seamCurve(1.004);
      grp.add(mesh(new THREE.TubeGeometry(curve, 260, 0.018, 6, true), phys({ color: '#e6e0d2', roughness: 0.7 })));
      const n = 96, st = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.022, 0.022), phys({ color: '#c41e2a', roughness: 0.6 }), n * 2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t), nrm = p.clone().normalize(), side = nrm.clone().cross(tg).normalize();
        for (const s of [-1, 1]) {
          const dir = side.clone().multiplyScalar(s).add(tg.clone().multiplyScalar(0.55)).normalize();
          q.setFromUnitVectors(up.set(1, 0, 0), dir);
          m4.compose(p.clone().add(side.clone().multiplyScalar(s * 0.045)).add(nrm.clone().multiplyScalar(0.01)), q, new THREE.Vector3(1, 1, 1));
          st.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4);
        }
      }
      grp.add(st);
      return grp;
    })();
    const balls = [[foot, -1.15, 0.55, 0.4, 1.0], [basket, 1.2, 0.75, -0.6, 1.05], [tennis, 0.95, -1.15, 0.6, 0.55], [base, -0.95, -1.2, 0.2, 0.62]].map(([b, x, y, z, s], i) => {
      b.position.set(x, y, z); b.scale.setScalar(s); b.userData.y = y; b.userData.ph = i * 1.7; b.userData.spin = 0.18 + i * 0.05; b.rotation.set(0.4 * i, i, 0); g.add(b); return b;
    });
    tick = (t, dt) => balls.forEach((b) => { b.position.y = b.userData.y + Math.sin(t * 0.8 + b.userData.ph) * 0.08; b.rotation.y += dt * b.userData.spin; b.rotation.x += dt * b.userData.spin * 0.3; });
  }

  if (kind === 'digits') {
    // A seven-segment display: lit segments in the page colour on a glossy black panel with a thin
    // chrome frame. Unlit segments are left out so the number reads at a glance.
    const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
    const P = { a: [0, 1, 1], b: [0.5, 0.5, 0], c: [0.5, -0.5, 0], d: [0, -1, 1], e: [-0.5, -0.5, 0], f: [-0.5, 0.5, 0], g: [0, 0, 1] };
    const hex = new THREE.Shape([[-0.4, 0], [-0.31, 0.085], [0.31, 0.085], [0.4, 0], [0.31, -0.085], [-0.31, -0.085]].map(([x, y]) => new THREE.Vector2(x, y)));
    const segGeo = new THREE.ExtrudeGeometry(hex, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 3 });
    segGeo.translate(0, 0, -0.06);
    const on = accent(false, { emissiveIntensity: 0.75, metalness: 0.05, roughness: 0.3 });
    on.toneMapped = false; // a lit segment glows in the full page colour instead of a washed-out pastel
    const text = String(value ?? '').replace(/x$/i, '×').slice(0, 8);
    const chars = new THREE.Group();
    let x = 0;
    const seg = (c, s) => { const [px, py, h] = P[s]; const m = mesh(segGeo, on, px, py, 0.04); if (!h) m.rotation.z = Math.PI / 2; c.add(m); };
    for (const ch of text) {
      const c = new THREE.Group();
      if (SEG[ch]) { for (const s of SEG[ch]) seg(c, s); c.position.x = x + 0.5; x += 1.4; }
      else if (ch === '.') { c.add(mesh(new THREE.SphereGeometry(0.11, 24, 16), on, 0.12, -1, 0.04)); c.position.x = x; x += 0.5; }
      else if (ch === '×' || ch === '+') {
        for (const r of ch === '×' ? [Math.PI / 4, -Math.PI / 4] : [0, Math.PI / 2]) { const m = mesh(segGeo, on, 0, 0, 0.04); m.rotation.z = r; m.scale.set(1.15, 1, 1); c.add(m); }
        c.position.set(x + 0.6, -0.2, 0); c.scale.setScalar(0.75); x += 1.3;
      } else continue;
      chars.add(c);
    }
    chars.position.x = -x / 2 + 0.25;
    const w = x + 0.7, panel = mesh(rounded(w, 3, 0.18, 0.28, 0.05), blackGloss(), 0, 0, -0.32);
    const frame = mesh(rounded(w + 0.16, 3.16, 0.1, 0.32, 0.03), chrome(), 0, 0, -0.42);
    g.add(frame, panel, chars);
    tick = (t) => { g.rotation.y = Math.sin(t * 0.35) * 0.32; g.rotation.x = Math.sin(t * 0.27) * 0.06; on.emissiveIntensity = 0.72 + Math.sin(t * 2.2) * 0.05; };
  }

  if (kind === 'target') {
    // A regulation dartboard drawn onto the face of a black cylinder.
    const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    const c = canvas(1024, 1024);
    if (c) {
      const x = c.getContext('2d'), C = 512, R = 500;
      x.fillStyle = '#101012'; x.fillRect(0, 0, 1024, 1024);
      const ring = (r0, r1, colA, colB) => ORDER.forEach((_, i) => { const a0 = -Math.PI / 2 - Math.PI / 20 + (i * TAU) / 20, a1 = a0 + TAU / 20; x.beginPath(); x.arc(C, C, r1, a0, a1); x.arc(C, C, r0, a1, a0, true); x.closePath(); x.fillStyle = i % 2 ? colB : colA; x.fill(); });
      const k = R * 0.78; // playing area radius inside the number ring
      ring(0, k, '#141414', '#efe2c4');
      ring(k * 0.94, k, '#c8202c', '#1d8a46');
      ring(k * 0.58, k * 0.63, '#c8202c', '#1d8a46');
      x.beginPath(); x.arc(C, C, k * 0.094, 0, TAU); x.fillStyle = '#1d8a46'; x.fill();
      x.beginPath(); x.arc(C, C, k * 0.037, 0, TAU); x.fillStyle = '#c8202c'; x.fill();
      x.strokeStyle = 'rgba(210,215,225,.75)'; x.lineWidth = 2.5;
      for (const r of [k, k * 0.94, k * 0.63, k * 0.58, k * 0.094, k * 0.037]) { x.beginPath(); x.arc(C, C, r, 0, TAU); x.stroke(); }
      ORDER.forEach((n, i) => { const a = -Math.PI / 2 - Math.PI / 20 + (i * TAU) / 20; x.beginPath(); x.moveTo(C + Math.cos(a) * k * 0.094, C + Math.sin(a) * k * 0.094); x.lineTo(C + Math.cos(a) * k, C + Math.sin(a) * k); x.stroke(); const am = a + Math.PI / 20; x.save(); x.translate(C + Math.cos(am) * R * 0.89, C + Math.sin(am) * R * 0.89); x.rotate(am + Math.PI / 2); x.fillStyle = '#f2f2f2'; x.font = '700 54px Inter, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 0, 0); x.restore(); });
    }
    const side = phys({ color: '#1a1a1d', roughness: 0.8 });
    const face = phys({ map: tex(c), color: c ? '#ffffff' : '#222', roughness: 0.85 });
    const board = mesh(new THREE.CylinderGeometry(2, 2, 0.3, 96), [side, face, side]);
    board.rotation.x = Math.PI / 2;
    const rim = mesh(new THREE.TorusGeometry(2.0, 0.07, 16, 120), chrome());
    g.add(board, rim);
    // The dart: steel tip, tungsten barrel, coloured shaft and flights.
    const dart = new THREE.Group();
    dart.add(mesh(new THREE.ConeGeometry(0.03, 0.35, 16), chrome(), 0, -0.175, 0));
    const barrel = mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.6, 24), phys({ color: '#9aa1ab', metalness: 1, roughness: 0.3 }), 0, 0.3, 0);
    dart.add(barrel, mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 12), accent(), 0, 0.85, 0));
    for (let i = 0; i < 4; i++) { const f = mesh(new THREE.PlaneGeometry(0.32, 0.42), accent(false, { side: THREE.DoubleSide, metalness: 0.1, roughness: 0.4 }), 0, 1.15, 0); f.rotation.y = (i * Math.PI) / 2; f.position.x = Math.cos((i * Math.PI) / 2) * 0.16; f.position.z = Math.sin((i * Math.PI) / 2) * 0.16; f.rotation.y = -(i * Math.PI) / 2; dart.add(f); }
    dart.rotation.x = -Math.PI / 2; // tip into the board
    const holder = new THREE.Group(); holder.add(dart); g.add(holder);
    tick = (t) => {
      const k = (t * 0.22) % 1, fly = Math.min(1, k / 0.22), e = 1 - (1 - fly) ** 3;
      holder.position.set(0.22 + (1 - e) * 2.2, 0.3 + (1 - e) * 1.2, 0.33 + (1 - e) * 5);
      holder.rotation.set(0.12 + (1 - e) * 0.2, -0.18, 0);
      g.rotation.y = -0.35 + Math.sin(t * 0.3) * 0.15; g.rotation.x = -0.08;
      board.rotation.z = fly >= 1 && k < 0.3 ? Math.sin((k - 0.22) * 140) * 0.01 : 0;
    };
  }

  if (kind === 'coins') {
    const prof = [[0, -0.075], [0.6, -0.075], [0.625, -0.055], [0.625, 0.055], [0.6, 0.075], [0.53, 0.075], [0.51, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
    const coinGeo = new THREE.LatheGeometry(prof, 64), mat = gold();
    const r = rng(11);
    const stacks = [[-1.25, 6, 0.2], [0, 10, -0.3], [1.25, 7, 0.1]].map(([x, n, z]) => {
      const s = new THREE.Group();
      for (let i = 0; i < n; i++) { const c = mesh(coinGeo, mat, (r() - 0.5) * 0.06, -1.6 + i * 0.155, (r() - 0.5) * 0.06); c.rotation.y = r() * TAU; s.add(c); }
      s.position.set(x, 0, z); g.add(s); return s;
    });
    const top = mesh(coinGeo, mat); g.add(top);
    tick = (t) => {
      stacks.forEach((s, i) => { s.rotation.y = t * (0.08 + i * 0.03); });
      const k = (t * 0.28) % 1, f = Math.min(1, k * 1.5);
      top.position.set(0.02, -1.6 + 10 * 0.155 + (1 - f) * 2.2 + Math.max(0, Math.sin(f * Math.PI)) * 0.4, -0.3);
      top.rotation.set((1 - f) * 9, k * 2, 0); top.visible = k < 0.9;
      g.rotation.y = Math.sin(t * 0.25) * 0.3;
    };
  }

  if (kind === 'bars') {
    const n = 7, bars = [], geo = rounded(0.42, 0.42, 1, 0.08, 0.03);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0.5, 0); // stand up, base at y = 0
    const mat = accent(false, { metalness: 0.25, roughness: 0.12, transparent: true, opacity: 0.92 });
    for (let i = 0; i < n; i++) { const b = mesh(geo, mat, (i - (n - 1) / 2) * 0.6, -1.5, 0); b.userData.ph = i * 0.9; g.add(b); bars.push(b); }
    g.add(mesh(rounded(4.6, 0.8, 0.12, 0.2, 0.04), blackGloss(), 0, -1.62, 0).rotateX(-Math.PI / 2));
    tick = (t) => { bars.forEach((b, i) => { b.scale.y = 0.6 + i * 0.32 + Math.sin(t * 1.1 + b.userData.ph) * 0.3; }); g.rotation.y = -0.4 + Math.sin(t * 0.3) * 0.25; g.rotation.x = 0.18; };
  }

  if (kind === 'trophy') {
    // One lathe profile walked bottom-up: foot, stem, bowl, lip, then down the inside to the floor
    // of the bowl, so the cup is open and every face points the right way.
    const prof = [[0, -1.25], [0.62, -1.25], [0.62, -1.15], [0.36, -1.05], [0.32, -0.95], [0.15, -0.8], [0.2, -0.38], [0.5, -0.15], [0.86, 0.3], [1.08, 0.9], [1.16, 1.42], [1.12, 1.5], [1.05, 1.44], [0.98, 0.9], [0.78, 0.42], [0.4, 0.22], [0, 0.18]].map(([x, y]) => new THREE.Vector2(x, y));
    const cup = mesh(new THREE.LatheGeometry(prof, 96), gold());
    g.add(cup);
    for (const s of [-1, 1]) { const curve = new THREE.CatmullRomCurve3([[1.0, 1.25], [1.65, 1.2], [1.7, 0.6], [1.15, 0.2], [0.75, 0.1]].map(([x, y]) => new THREE.Vector3(s * x, y, 0))); g.add(mesh(new THREE.TubeGeometry(curve, 48, 0.07, 12, false), gold())); }
    g.add(mesh(rounded(1.7, 1.7, 0.55, 0.12, 0.04), phys({ color: '#1c1d23', metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }), 0, -1.55, 0).rotateX(-Math.PI / 2));
    g.add(mesh(rounded(1.1, 0.22, 0.02, 0.03, 0.01), gold(), 0, -1.55, 0.88));
    tick = (t) => { g.rotation.y = t * 0.3; };
  }

  if (kind === 'radar') {
    const disc = new THREE.Group();
    disc.add(mesh(new THREE.CylinderGeometry(2, 2, 0.16, 96), phys({ color: '#030507', metalness: 0, roughness: 0.55 })));
    disc.add(mesh(new THREE.TorusGeometry(2.0, 0.09, 16, 120), chrome()).rotateX(Math.PI / 2));
    for (const r of [0.6, 1.2, 1.8]) disc.add(mesh(new THREE.TorusGeometry(r, 0.012, 6, 120), glow(false, 0.55), 0, 0.09, 0).rotateX(Math.PI / 2));
    const cross = new THREE.Group();
    for (const a of [0, Math.PI / 2]) { const l = mesh(new THREE.BoxGeometry(3.8, 0.006, 0.012), glow(false, 0.35), 0, 0.09, 0); l.rotation.y = a; cross.add(l); }
    disc.add(cross);
    const c = canvas(256, 256);
    if (c) { const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.95)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); }
    const sweep = mesh(new THREE.CircleGeometry(1.95, 48, 0, 0.9), new THREE.MeshBasicMaterial({ color: '#ffffff', map: tex(c), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, 0.1, 0);
    tinted.push(sweep.material); sweep.rotation.x = -Math.PI / 2; disc.add(sweep);
    const blips = Array.from({ length: 6 }, (_, i) => { const a = i * 1.9, r = 0.5 + (i % 3) * 0.5; const b = mesh(new THREE.SphereGeometry(0.07, 16, 12), glow(false, 1), Math.cos(a) * r, 0.12, Math.sin(a) * r); b.userData.a = ((-a % TAU) + TAU) % TAU; disc.add(b); return b; });
    disc.rotation.x = 1.0; g.add(disc);
    tick = (t) => {
      const ang = (t * 1.1) % TAU; sweep.rotation.z = ang - 0.9;
      blips.forEach((b) => { const d = ((ang - b.userData.a) % TAU + TAU) % TAU; b.material.opacity = Math.max(0.12, 1 - d / 3) * (b.material.userData.f ?? 1); b.scale.setScalar(1 + Math.max(0, 0.6 - d) * 1.6); });
      g.rotation.y = Math.sin(t * 0.25) * 0.25;
    };
  }

  if (kind === 'star') {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.78 : 1.9, a = Math.PI / 2 + (i / 10) * TAU; (i ? sh.lineTo : sh.moveTo).call(sh, Math.cos(a) * r, Math.sin(a) * r); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.32, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.14, bevelSegments: 5 });
    geo.center();
    const s = mesh(geo, gold()); g.add(s);
    tick = (t) => { s.rotation.y = Math.sin(t * 0.5) * 0.7; s.position.y = Math.sin(t * 0.9) * 0.08; };
  }

  if (kind === 'scale') {
    const m = brass();
    g.add(mesh(new THREE.LatheGeometry([[0, -1.9], [1.0, -1.9], [1.0, -1.78], [0.7, -1.7], [0.2, -1.6], [0, -1.6]].map(([x, y]) => new THREE.Vector2(x, y)), 48), m));
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.9, 24), m, 0, -0.2, 0));
    g.add(mesh(new THREE.SphereGeometry(0.16, 24, 16), m, 0, 1.28, 0));
    const arm = new THREE.Group(); arm.position.y = 1.15; g.add(arm);
    arm.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 16), m).rotateZ(Math.PI / 2));
    const pans = [-1.8, 1.8].map((x) => {
      const p = new THREE.Group(); p.position.x = x;
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU, end = new THREE.Vector3(Math.cos(a) * 0.5, -1.15, Math.sin(a) * 0.5), len = end.length(); const ch = mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), chrome()); ch.position.copy(end.clone().multiplyScalar(0.5)); ch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().normalize()); p.add(ch); }
      p.add(mesh(new THREE.LatheGeometry([[0, -1.3], [0.55, -1.22], [0.62, -1.12], [0.6, -1.1], [0.5, -1.17], [0, -1.24]].map(([px, py]) => new THREE.Vector2(px, py)), 48), m));
      arm.add(p); return p;
    });
    tick = (t) => { const a = Math.sin(t * 0.7) * 0.14; arm.rotation.z = a; pans.forEach((p) => { p.rotation.z = -a; }); g.rotation.y = Math.sin(t * 0.3) * 0.45; };
  }

  if (kind === 'duel') {
    // value: { pHome, pAway }: two columns whose heights are the win chances.
    const ph = value?.pHome ?? 0.5, pa = value?.pAway ?? 0.5, max = Math.max(ph, pa, 0.01);
    [[ph, -0.85, false], [pa, 0.85, true]].forEach(([p, x, b]) => {
      const h = 0.5 + (p / max) * 3.0;
      const geo = rounded(1.1, 1.1, h, 0.16, 0.05); geo.rotateX(-Math.PI / 2); geo.translate(0, h / 2, 0);
      g.add(mesh(geo, accent(b, { metalness: 0.3, roughness: 0.14, emissiveIntensity: 0.22 }), x, -1.8, 0));
    });
    g.add(mesh(rounded(3.6, 1.8, 0.14, 0.2, 0.04), blackGloss(), 0, -1.9, 0).rotateX(-Math.PI / 2));
    tick = (t) => { g.rotation.y = -0.45 + Math.sin(t * 0.3) * 0.25; g.rotation.x = 0.12; };
  }

  // Fit every emblem into the same footprint, centred on its own middle.
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  while (g.children.length) inner.add(g.children[0]);
  const fitScale = 4 / Math.max(size.x, size.y, 0.01);
  inner.position.copy(centre.multiplyScalar(-fitScale)); inner.scale.setScalar(fitScale);
  g.add(inner);
  const mats = new Set();
  g.traverse((o) => { (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m) => mats.add(m)); });
  mats.forEach((m) => { m.userData.base = m.opacity; m.userData.transparent = m.transparent; m.userData.depthWrite = m.depthWrite; });
  g.userData = {
    kind,
    tick: (t, dt) => tick(t, dt),
    tint(a, b = a, k = 0.06) {
      tinted.forEach((m) => { m.color.lerp(a, k); m.emissive?.lerp(a, k); });
      tintedB.forEach((m) => { m.color.lerp(b, k); m.emissive?.lerp(b, k); });
    },
    // Fade without breaking solid objects: fully faded-in materials go back to opaque.
    setOpacity(f) {
      mats.forEach((m) => {
        const solid = f >= 0.999;
        m.transparent = solid ? m.userData.transparent : true;
        // Solid parts keep writing depth while fading, so their own back faces never show through.
        m.opacity = m.userData.base * f; m.userData.f = f;
      });
    },
    dispose() { g.traverse((o) => { o.geometry?.dispose(); }); mats.forEach((m) => { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); }); },
  };
  return g;
}

// Which emblem a page shows when it does not ask for one itself.
export const EMBLEM_FOR_MODE = { home: 'balls', sport: 'balls', bankers: 'coins', edge: 'bars', mega: 'digits', x: 'digits', match: 'duel', other: null, race: null };
