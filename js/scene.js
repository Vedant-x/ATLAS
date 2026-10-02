// ATLAS WebGL engine.
//  - Energy core: noise-displaced icosphere with a fresnel shader (two of them face off on match pages)
//  - 9k-particle field that morphs between formations per page: sphere, stadium, helix, galaxy
//  - Energy beam between the match cores, orbit rings, bloom post-processing
// API: setMode(mode, opts), setAccent(hex), pulse()
import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

function coreMaterial(color, wire = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: 0.28 }, uFreq: { value: 1.4 }, uPulse: { value: 0 },
      uColor: { value: new THREE.Color(color) }, uDeep: { value: new THREE.Color('#05060a') }, uAlpha: { value: wire ? 0.22 : 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uAmp, uFreq, uPulse;
      varying vec3 vN; varying vec3 vV; varying float vNoise;
      ${NOISE}
      void main(){
        float n = snoise(normal * uFreq + vec3(uTime * .35));
        float n2 = snoise(normal * uFreq * 3. - vec3(uTime * .6)) * .35;
        vNoise = n + n2;
        vec3 p = position + normal * (vNoise * uAmp * (1. + uPulse * 2.));
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uDeep; uniform float uAlpha, uPulse;
      varying vec3 vN; varying vec3 vV; varying float vNoise;
      void main(){
        float f = pow(1. - max(dot(vN, vV), 0.), 2.6);
        float bands = smoothstep(.35, .5, fract(vNoise * 3.)) * .25;
        vec3 base = mix(uDeep, uColor * .32, .85);
        vec3 c = mix(base, uColor * 1.15, f) + uColor * (bands * .6 + max(vNoise, 0.) * .2) + uColor * uPulse * .6;
        gl_FragColor = vec4(c, uAlpha < 1. ? uAlpha * (.4 + f * .8) : 1.);
      }`,
    transparent: wire, wireframe: wire, depthWrite: !wire, blending: wire ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

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
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function beam() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color('#fff') }, uB: { value: new THREE.Color('#fff') }, uSplit: { value: 0.5 }, uAlpha: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uSplit, uAlpha; uniform vec3 uA, uB; varying vec2 vUv;
      void main(){
        float flow = smoothstep(.3, 1., sin((vUv.x * 30.) - uTime * 6.) * .5 + .5);
        float edge = 1. - abs(vUv.y - .5) * 2.;
        vec3 c = mix(uA, uB, smoothstep(uSplit - .04, uSplit + .04, vUv.x));
        float clash = exp(-pow((vUv.x - uSplit) * 18., 2.)) * 2.5;
        gl_FragColor = vec4(c * (1.2 + clash), (flow * .6 + .25 + clash) * edge * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.4, 0, 0), new THREE.Vector3(0, 0.6, 0.4), new THREE.Vector3(3.4, 0, 0)]);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.05, 12, false), mat);
}

const FORMATION = { home: [1, 0, 0, 0], sport: [0, 1, 0, 0], match: [0, 1, 0, 0], x: [0, 0, 1, 0], mega: [0, 0, 0, 1], bankers: [1, 0, 0, 0], edge: [0, 0, 1, 0], other: [1, 0, 0, 0] };

export function createScene(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    canvas.classList.add('no-webgl');
    const noop = () => {};
    return { setMode: noop, setAccent: noop, pulse: noop, ok: false };
  }
  const small = Math.min(innerWidth, innerHeight) < 700;
  const dpr = Math.min(devicePixelRatio, small ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x040406, 0.03);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 11);

  const world = new THREE.Group();
  scene.add(world);

  const detail = small ? 16 : 28;
  const makeCore = (color) => {
    const g = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(1.7, detail);
    const solid = new THREE.Mesh(geo, coreMaterial(color));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.95, small ? 6 : 10), coreMaterial(color, true));
    g.add(solid, wire);
    g.userData = { solid, wire };
    return g;
  };
  const coreA = makeCore('#d2ff00');
  const coreB = makeCore('#ff3d6e');
  coreB.scale.setScalar(0.001);
  world.add(coreA, coreB);

  const rings = [2.7, 3.2, 3.9].map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008 + i * 0.003, 6, 220),
      new THREE.MeshBasicMaterial({ color: '#d2ff00', transparent: true, opacity: 0.55 - i * 0.12, blending: THREE.AdditiveBlending }));
    m.rotation.set(Math.PI / 2 + (i - 1) * 0.45, i * 0.6, 0);
    coreA.add(m);
    return m;
  });

  const field = particleField(small ? 3500 : 7000);
  field.material.uniforms.uPixel.value = dpr;
  scene.add(field);
  const link = beam();
  world.add(link);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), small ? 0.45 : 0.6, 0.55, 0.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2); // half-res glow: same look, far cheaper
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  // Animated state; GSAP tweens these plain objects, the loop applies them.
  const st = {
    pulse: 0, scatter: 0,
    coreAx: 3.2, coreAs: 1, coreBx: 6, coreBs: 0.001, beam: 0, split: 0.5,
    camZ: 11, camY: 0, fieldY: 0, worldRotZ: 0,
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

    for (const core of [coreA, coreB]) {
      for (const m of [core.userData.solid, core.userData.wire]) {
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uPulse.value = st.pulse;
        m.material.uniforms.uAmp.value = 0.22 + Math.min(Math.abs(scrollV) * 0.004, 0.25);
      }
      core.rotation.y += dt * 0.18;
      core.userData.wire.rotation.x -= dt * 0.08;
    }
    coreA.userData.solid.material.uniforms.uColor.value.lerp(target.a, 0.05);
    coreA.userData.wire.material.uniforms.uColor.value.lerp(target.a, 0.05);
    coreB.userData.solid.material.uniforms.uColor.value.lerp(target.b, 0.05);
    coreB.userData.wire.material.uniforms.uColor.value.lerp(target.b, 0.05);
    rings.forEach((r, i) => { r.rotation.z += dt * (0.25 + i * 0.12) * (1 + st.pulse * 4); r.material.color.lerp(target.a, 0.05); });
    field.material.uniforms.uColor.value.lerp(target.accent, 0.04);

    coreA.position.set(st.coreAx - sp * 2, -sp * 1.2, 0); coreA.scale.setScalar(st.coreAs * (1 + st.pulse * 0.15));
    coreB.position.set(st.coreBx + sp * 2, -sp * 1.2, 0); coreB.scale.setScalar(st.coreBs * (1 + st.pulse * 0.15));
    link.material.uniforms.uTime.value = t;
    link.material.uniforms.uAlpha.value = st.beam;
    link.material.uniforms.uSplit.value = st.split;
    link.material.uniforms.uA.value.copy(target.a); link.material.uniforms.uB.value.copy(target.b);
    link.position.y = -sp * 1.2;

    field.material.uniforms.uTime.value = t;
    field.material.uniforms.uScatter.value = st.scatter;
    field.position.y = st.fieldY;
    field.rotation.x = 0.25 + sp * 0.6;

    world.rotation.y = mouse.x * 0.18;
    world.rotation.x = mouse.y * 0.1;
    world.rotation.z = st.worldRotZ;
    camera.position.set(mouse.x * 0.6, st.camY - mouse.y * 0.3, st.camZ - sp * 2.5);
    camera.lookAt(0, st.camY * 0.5, 0);

    st.pulse *= 0.95;
    composer.render();
    requestAnimationFrame(frame);
  }
  frame();

  return {
    ok: true,
    setAccent(hex) { target.accent.set(hex); target.a.set(hex); },
    pulse() { st.pulse = 1; if (window.gsap) window.gsap.fromTo(st, { scatter: 1 }, { scatter: 0, duration: 1.4, ease: 'expo.out' }); },
    // mode: home | sport | match | x | mega | bankers | edge | other
    setMode(mode, opts = {}) {
      const fw = FORMATION[mode] || FORMATION.other;
      tween(w, { x: fw[0], y: fw[1], z: fw[2], w: fw[3] });
      const wide = innerWidth > 900;
      if (mode === 'match') {
        const ph = opts.pHome ?? 0.5, pa = opts.pAway ?? 0.5;
        target.a.set(opts.home || '#d2ff00'); target.b.set(opts.away || '#ff3d6e');
        tween(st, { coreAx: wide ? -3.6 : -1.9, coreAs: 0.45 + Math.sqrt(ph) * 0.75, coreBx: wide ? 3.6 : 1.9, coreBs: 0.45 + Math.sqrt(pa) * 0.75,
          beam: 1, split: ph / (ph + pa), camZ: wide ? 12 : 14, camY: 0, fieldY: -0.5, worldRotZ: 0 });
      } else {
        const layouts = {
          home: { coreAx: wide ? 3.4 : 0, coreAs: 1, camZ: 11, camY: 0, fieldY: 0 },
          sport: { coreAx: wide ? 3.6 : 0, coreAs: 0.75, camZ: 12, camY: 1.2, fieldY: 0 },
          x: { coreAx: wide ? 4 : 0, coreAs: 0.6, camZ: 12, camY: 0, fieldY: 0 },
          mega: { coreAx: 0, coreAs: 0.55, camZ: 13, camY: 2.5, fieldY: -1 },
          bankers: { coreAx: wide ? 3.6 : 0, coreAs: 0.9, camZ: 11, camY: 0, fieldY: 0 },
          edge: { coreAx: wide ? 4.2 : 0, coreAs: 0.5, camZ: 13, camY: 0, fieldY: 0 },
        };
        tween(st, { ...(layouts[mode] || layouts.home), coreBx: 7, coreBs: 0.001, beam: 0, worldRotZ: mode === 'x' ? 0.2 : 0 });
      }
    },
  };
}
