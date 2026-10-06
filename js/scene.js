// ATLAS WebGL engine.
//  - 9k-particle field that morphs between formations per page: sphere, stadium, helix, galaxy
//  - Sport venues and the F1 circuit (single pass, no post-processing)
// API: setMode(mode, opts), setAccent(hex), pulse()
import * as THREE from '../vendor/three.module.js';
import { VENUES } from './venues.js';

// ---------- particle formations ----------
function formations(N) {
  const sphere = new Float32Array(N * 3), stadium = new Float32Array(N * 3), helix = new Float32Array(N * 3), galaxy = new Float32Array(N * 3);
  const rnd = new Float32Array(N);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const r = Math.random(); rnd[i] = r;
    // Fibonacci sphere shell with a little depth
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i, R = 4.2 + (Math.random() - 0.5) * 0.35;
    sphere.set([Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R], i * 3);
    // Stadium: stepped elliptical bowl + pitch lines
    if (i % 5 === 0) {
      const u = Math.random() * 2 - 1, v = Math.random() * 2 - 1;
      const onLine = Math.random() < 0.5;
      stadium.set([onLine ? u * 4 : (Math.random() < 0.5 ? -4 : 4) * Math.sign(u || 1), -1.6, onLine ? (Math.random() < 0.5 ? -2.4 : 2.4) : v * 2.4], i * 3);
    } else {
      const tier = Math.floor(Math.random() * 7), a = Math.random() * Math.PI * 2, s = 1 + tier * 0.16;
      stadium.set([Math.cos(a) * 5.4 * s, -1.6 + tier * 0.38, Math.sin(a) * 3.6 * s], i * 3);
    }
    // Double helix along x
    const t = (i / N) * 14 - 7, strand = i % 2 ? Math.PI : 0, hr = 1.5 + (Math.random() - 0.5) * 0.25;
    helix.set([t * 1.2, Math.cos(t * 1.6 + strand) * hr, Math.sin(t * 1.6 + strand) * hr], i * 3);
    if (i % 9 === 0) helix.set([t * 1.2, Math.cos(t * 1.6) * hr * (Math.random() * 2 - 1), Math.sin(t * 1.6) * hr * (Math.random() * 2 - 1)], i * 3);
    // Galaxy: 4 logarithmic arms
    const arm = i % 4, gr = Math.pow(Math.random(), 1.6) * 7.5, ga = gr * 0.85 + (arm / 4) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    galaxy.set([Math.cos(ga) * gr, (Math.random() - 0.5) * (0.6 - gr * 0.05), Math.sin(ga) * gr], i * 3);
  }
  return { sphere, stadium, helix, galaxy, rnd };
}

function particleField(N) {
  const f = formations(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f.sphere, 3));
  geo.setAttribute('p1', new THREE.BufferAttribute(f.stadium, 3));
  geo.setAttribute('p2', new THREE.BufferAttribute(f.helix, 3));
  geo.setAttribute('p3', new THREE.BufferAttribute(f.galaxy, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(f.rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uSize: { value: 26 }, uPixel: { value: 1 },
      uColor: { value: new THREE.Color('#d2ff00') }, uScatter: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute float aRand;
      uniform vec4 uW; uniform float uTime, uSize, uPixel, uScatter;
      varying float vR; varying float vDepth;
      void main(){
        vec3 p = position * uW.x + p1 * uW.y + p2 * uW.z + p3 * uW.w;
        float a = uTime * (.03 + aRand * .05) * (1. - uW.y * .8);
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
        p += vec3(sin(uTime * .7 + aRand * 40.), cos(uTime * .5 + aRand * 30.), sin(uTime * .6 + aRand * 20.)) * (.06 + uScatter * 2.5 * aRand);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = uSize * uPixel * (.35 + aRand) / -mv.z;
        vR = aRand; vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vR; varying float vDepth;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, 0., d);
        vec3 c = mix(vec3(1.), uColor, step(.55, vR) * .9);
        gl_FragColor = vec4(c * (1. + step(.97, vR) * 1.5), a * (.22 + vR * .5) * smoothstep(40., 6., vDepth));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

const lerpN = (a, b, k) => a + (b - a) * k;
const FORMATION = { home: [1, 0, 0, 0], sport: [0, 1, 0, 0], match: [0, 1, 0, 0], x: [0, 0, 1, 0], mega: [0, 0, 0, 1], bankers: [1, 0, 0, 0], edge: [0, 0, 1, 0], race: [0, 0, 0, 1], other: [1, 0, 0, 0] };

// Soft radial glow drawn once; replaces the bloom post-process.
let glowTex;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.25, 'rgba(255,255,255,.35)'); g.addColorStop(0.6, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// The scene renders in ONE pass straight to the canvas. An earlier bloom post-process (off-screen
// render targets at a different pixel ratio) could leave part of the canvas black on some GPUs.
export function createScene(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    canvas.classList.add('no-webgl');
    const noop = () => {};
    return { setMode: noop, setAccent: noop, pulse: noop, setTrack: noop, setCars: noop, ok: false };
  }
  const small = Math.min(innerWidth, innerHeight) < 700;
  const pixelRatio = () => Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5);
  let dpr = pixelRatio();
  renderer.setPixelRatio(dpr);
  // A lost GPU context would leave a black canvas: fall back to the CSS glow instead.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); canvas.classList.add('no-webgl'); });
  canvas.addEventListener('webglcontextrestored', () => { canvas.classList.remove('no-webgl'); resize(); });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x040406, 0.03);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 11);

  const world = new THREE.Group();
  scene.add(world);

  const field = particleField(small ? 3500 : 7000);
  field.material.uniforms.uPixel.value = dpr;
  scene.add(field);

  // ---------- race mode: the Grand Prix circuit in 3D ----------
  // Built from real car position data (data/f1.json): a glowing racing line, a soft halo, kerb dots,
  // the start/finish line and cars lapping it (real positions during live sessions).
  const track = new THREE.Group();
  track.visible = false;
  scene.add(track);
  const TRACK_R = 5.4;
  let curve = null, trackParts = [], ghosts = [], liveCars = [], liveMode = 0;
  const carSprite = (color, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.scale.setScalar(size);
    return sp;
  };
  function setTrack(points) {
    trackParts.forEach((m) => { track.remove(m); m.geometry?.dispose(); m.material?.dispose(); });
    ghosts.forEach((g) => g.parts.forEach((p) => { track.remove(p); p.material.dispose(); }));
    liveCars.forEach((c) => { track.remove(c); c.material.dispose(); });
    trackParts = []; ghosts = []; liveCars = []; curve = null; liveMode = 0;
    if (!points?.length) return;
    curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x * TRACK_R, 0, -y * TRACK_R)), true, 'centripetal');
    const seg = Math.min(900, points.length * 3);
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, 0.06, 6, true), new THREE.MeshBasicMaterial({ color: target.accent.clone(), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, 0.24, 8, true), new THREE.MeshBasicMaterial({ color: target.accent.clone(), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    const asphalt = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, 0.16, 6, true), new THREE.MeshBasicMaterial({ color: '#16161c', transparent: true, opacity: 0.85, depthWrite: false }));
    asphalt.position.y = -0.05;
    // Kerb dots alongside the line.
    const n = 360, kerb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const p = curve.getPointAt(i / n), tg = curve.getTangentAt(i / n); kerb.set([p.x - tg.z * 0.3, 0, p.z + tg.x * 0.3], i * 3); }
    const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.BufferAttribute(kerb, 3));
    const kerbs = new THREE.Points(kg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.05, transparent: true, opacity: 0.45, depthWrite: false }));
    // Start/finish line.
    const s0 = curve.getPointAt(0), t0 = curve.getTangentAt(0);
    const start = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.07), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
    start.position.copy(s0); start.lookAt(s0.clone().add(new THREE.Vector3(-t0.z, 0, t0.x)));
    trackParts = [asphalt, halo, line, kerbs, start];
    track.add(...trackParts);
    // Three "ghost" cars lapping with trails until live positions arrive.
    ghosts = [['#ff2a2a', 0, 1], ['#ffffff', 0.035, 0.985], ['#ffd84d', 0.07, 0.97]].map(([c, off, sp]) => {
      const parts = Array.from({ length: 7 }, (_, k) => carSprite(c, k ? 0.42 - k * 0.05 : 0.7));
      parts.forEach((p, k) => { p.material.opacity = k ? 0.5 - k * 0.06 : 1; track.add(p); });
      return { parts, off, sp };
    });
  }
  // ---------- every other sport: its own playing surface ----------
  // Real markings drawn as glowing lines on a canvas (to scale), the sport's posts/hoops/nets as 3D
  // lines and a ball moving the way that sport's ball moves (venues.js).
  const venue = new THREE.Group();
  venue.visible = false;
  scene.add(venue);
  let venueId = null, venueParts = [], venueBall = null, venueDef = null;
  function setVenue(id) {
    if (id === venueId) return;
    venueParts.forEach((m) => { venue.remove(m); m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); });
    if (venueBall) { venue.remove(venueBall); venueBall.material.dispose(); }
    venueParts = []; venueBall = null; venueId = id; venueDef = VENUES[id] || null;
    if (!venueDef) return;
    const W = 1024, H = Math.round(W / venueDef.aspect);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(255,255,255,.035)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 3.2; c.lineJoin = 'round'; c.lineCap = 'round';
    c.shadowColor = '#fff'; c.shadowBlur = 14;
    try { venueDef.draw(c, W, H); } catch { /* a drawing error must never break the page */ }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const R = TRACK_R, depth = (2 * R) / venueDef.aspect;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, depth), new THREE.MeshBasicMaterial({ map: tex, color: target.accent.clone(), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    surface.rotation.x = -Math.PI / 2;
    venueParts.push(surface);
    if (venueDef.props?.length) {
      const pos = new Float32Array(venueDef.props.length * 3);
      venueDef.props.forEach(([x, y, z], i) => pos.set([x * R, y * R, z * R], i * 3));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      venueParts.push(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
    venue.add(...venueParts);
    if (venueDef.ball) { venueBall = carSprite('#ffffff', 0.45); venue.add(venueBall); }
  }

  // Live: [{ x, y, color }] in the same normalised map coordinates as the track points.
  function setCars(cars) {
    if (!curve) return;
    while (liveCars.length < cars.length) { const c = carSprite('#ffffff', 0.55); track.add(c); liveCars.push(c); }
    liveCars.forEach((c, i) => {
      const car = cars[i];
      c.visible = Boolean(car);
      if (!car) return;
      c.material.color.set(car.color || '#ffffff');
      c.userData.to = new THREE.Vector3(car.x * TRACK_R, 0.06, -car.y * TRACK_R);
      if (!c.userData.placed) { c.position.copy(c.userData.to); c.userData.placed = true; }
    });
    liveMode = 1;
  }

  const resize = () => {
    dpr = pixelRatio();
    renderer.setPixelRatio(dpr);
    field.material.uniforms.uPixel.value = dpr;
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  let queued = 0;
  const schedule = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(resize); };
  addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { schedule(); watchDpr(); }, { once: true });
  watchDpr();
  // Safety net: if the drawing buffer ever disagrees with the window, fix it on the next frame.
  const checkSize = () => {
    const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
    if (Math.abs(canvas.width - w) > 2 || Math.abs(canvas.height - h) > 2 || dpr !== pixelRatio()) resize();
  };
  resize();

  // Animated state; GSAP tweens these plain objects, the loop applies them.
  const st = {
    pulse: 0, scatter: 0,
    camZ: 11, camY: 0, fieldY: 0, worldRotZ: 0, track: 0, venue: 0, venueFloor: 0,
  };
  const target = { accent: new THREE.Color('#d2ff00'), a: new THREE.Color('#d2ff00'), b: new THREE.Color('#ff3d6e') };
  const w = field.material.uniforms.uW.value;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = (e.clientY / innerHeight) * 2 - 1; });
  let scrollV = 0, lastY = scrollY;

  const tween = (obj, props) => (window.gsap ? window.gsap.to(obj, { duration: 1.6, ease: 'expo.inOut', ...props }) : Object.assign(obj, props));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime * (reduced ? 0.3 : 1);
    mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04;
    scrollV += ((scrollY - lastY) - scrollV) * 0.1; lastY = scrollY;
    const sp = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);

    field.material.uniforms.uColor.value.lerp(target.accent, 0.04);

    field.material.uniforms.uTime.value = t;
    field.material.uniforms.uScatter.value = st.scatter;
    field.position.y = st.fieldY;
    field.rotation.x = 0.25 + sp * 0.6;

    // Race mode: fade the circuit in, lap the cars, ease live cars to their latest positions.
    track.visible = st.track > 0.01 && Boolean(curve);
    if (track.visible) {
      const aspect = innerWidth / innerHeight;
      // Desktop: the circuit fills the right of the hero; phones: smaller, behind the session strip.
      const wideNow = innerWidth > 900;
      track.scale.setScalar((wideNow ? 0.7 : Math.min(0.58, aspect * 0.95)) * (0.9 + st.track * 0.1));
      track.position.set(wideNow ? 3.4 : 0.2, (wideNow ? 1.4 : 3.4) + sp * 4, 0);
      track.rotation.y = mouse.x * 0.25 + Math.sin(t * 0.05) * 0.2;
      track.rotation.x = 0.75 + mouse.y * 0.08; // tipped toward the viewer: read as a circuit seen from above
      trackParts.forEach((m, i) => { m.material.opacity = [0.85, 0.12, 0.95, 0.45, 0.9][i] * st.track; if (i === 1 || i === 2) m.material.color.lerp(target.accent, 0.05); });
      for (const g of ghosts) {
        g.parts.forEach((p, k) => {
          p.visible = !liveMode;
          const u = ((t * 0.045 * g.sp - g.off - k * 0.0035) % 1 + 1) % 1;
          p.position.copy(curve.getPointAt(u)); p.position.y = 0.06;
          p.material.opacity = (k ? 0.5 - k * 0.06 : 1) * st.track;
        });
      }
      for (const c of liveCars) if (c.userData.to) { c.position.lerp(c.userData.to, 0.08); c.material.opacity = st.track; }
    }
    // Sport venues: beside the headline on sport/league pages, as the floor under the two teams on a match.
    venue.visible = st.venue > 0.01 && Boolean(venueDef);
    if (venue.visible) {
      const wideNow = innerWidth > 900, aspect = innerWidth / innerHeight, fl = st.venueFloor;
      const side = { s: wideNow ? 0.7 : Math.min(0.55, aspect * 0.95), x: wideNow ? 3.4 : 0.2, y: wideNow ? 1.3 : 2.3, rx: 0.8 };
      const floor = { s: wideNow ? 1.25 : Math.min(0.9, aspect * 1.4), x: 0, y: wideNow ? -2.7 : -1.2, rx: 0.42 };
      venue.scale.setScalar(lerpN(side.s, floor.s, fl) * (0.9 + st.venue * 0.1));
      venue.position.set(lerpN(side.x, floor.x, fl), lerpN(side.y, floor.y, fl) + sp * (fl ? 1 : 4), 0);
      venue.rotation.set(lerpN(side.rx, floor.rx, fl) + mouse.y * 0.06, mouse.x * 0.25 + Math.sin(t * 0.05) * (fl ? 0.05 : 0.2), 0);
      venueParts.forEach((m, i) => { m.material.opacity = (i ? 0.85 : 0.95) * st.venue * (1 - 0.45 * fl); if (!i) m.material.color.lerp(target.accent, 0.05); }); // dimmer as a floor, behind text
      if (venueBall && venueDef.ball) { const [x, y, z] = venueDef.ball(t); venueBall.position.set(x * TRACK_R, y * TRACK_R + 0.04, z * TRACK_R); venueBall.material.opacity = st.venue; }
    }

    world.rotation.y = mouse.x * 0.18;
    world.rotation.x = mouse.y * 0.1;
    world.rotation.z = st.worldRotZ;
    camera.position.set(mouse.x * 0.6, st.camY - mouse.y * 0.3, st.camZ - sp * 2.5);
    camera.lookAt(0, st.camY * 0.5, 0);

    st.pulse *= 0.95;
    checkSize();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();

  return {
    ok: true,
    setAccent(hex) { target.accent.set(hex); target.a.set(hex); },
    setTrack(points) { if (JSON.stringify(points?.[0]) !== track.userData.first || (points?.length || 0) !== track.userData.n) { track.userData.first = JSON.stringify(points?.[0]); track.userData.n = points?.length || 0; setTrack(points); } },
    setCars,
    pulse() { st.pulse = 1; if (window.gsap) window.gsap.fromTo(st, { scatter: 1 }, { scatter: 0, duration: 1.4, ease: 'expo.out' }); },
    // mode: home | sport | match | x | mega | bankers | edge | other
    setMode(mode, opts = {}) {
      const fw = FORMATION[mode] || FORMATION.other;
      if (mode !== 'match') { target.b.copy(target.a); }
      tween(w, { x: fw[0], y: fw[1], z: fw[2], w: fw[3] });
      const wide = innerWidth > 900;
      const sportVenue = (mode === 'sport' || mode === 'match') && opts.sport && VENUES[opts.sport] ? opts.sport : null;
      if (sportVenue) setVenue(sportVenue);
      tween(st, { venue: sportVenue ? 1 : 0, venueFloor: mode === 'match' ? 1 : 0 });
      if (mode === 'race') {
        if (opts.track) this.setTrack(opts.track);
        tween(st, { camZ: wide ? 10.5 : 12, camY: 3.2, fieldY: -2.5, worldRotZ: 0, track: 1 });
        return;
      }
      tween(st, { track: 0 });
      if (mode === 'match') {
        target.a.set(opts.home || '#d2ff00'); target.b.set(opts.away || '#ff3d6e');
        tween(st, { camZ: wide ? 12 : 11, camY: 0, fieldY: -0.5, worldRotZ: 0 });
      } else {
        const lay = { camZ: mode === 'home' ? 11 : 12, camY: mode === 'sport' ? 1.2 : 0, fieldY: 0 };
        tween(st, { ...lay, worldRotZ: 0 });
      }
    },
  };
}
