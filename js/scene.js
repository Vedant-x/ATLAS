// Full-screen WebGL backdrop: a glowing wireframe "helmet" orb, orbiting rings and a particle
// tunnel. Reacts to mouse, scroll and route changes (setAccent / pulse).
import * as THREE from '../vendor/three.module.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050507, 0.045);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 9);

  const accent = new THREE.Color('#d2ff00');
  const group = new THREE.Group();
  scene.add(group);

  // Core orb: icosahedron wireframe + inner glow.
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2, 3),
    new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.35 })
  );
  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.4, 1),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08 })
  );
  group.add(core, inner);

  // Orbit rings.
  const rings = [2.8, 3.4, 4.1].map((rad, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rad, 0.012, 8, 160),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 - i * 0.12 })
    );
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.5;
    ring.rotation.y = i * 0.7;
    group.add(ring);
    return ring;
  });

  // Particle tunnel.
  const N = 2400;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 6 + Math.random() * 10;
    pos[i * 3] = Math.cos(a) * rad;
    pos[i * 3 + 1] = Math.sin(a) * rad;
    pos[i * 3 + 2] = -Math.random() * 120 + 10;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.7 })
  );
  scene.add(particles);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / innerHeight) * 2 - 1;
  });

  let scroll = 0, speed = 1, burst = 0;
  const target = accent.clone();

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    scroll = scrollY / Math.max(1, document.body.scrollHeight - innerHeight);
    burst *= 0.94;

    accent.lerp(target, 0.05);
    const k = reduced ? 0.2 : 1;
    core.rotation.y += dt * 0.25 * k * (1 + burst * 6);
    core.rotation.x += dt * 0.1 * k;
    inner.scale.setScalar(1 + Math.sin(t * 2) * 0.05 + burst * 0.4);
    rings.forEach((r, i) => (r.rotation.z += dt * (0.2 + i * 0.15) * k * (1 + burst * 4)));

    group.position.x = 3.2 - scroll * 6.4 + mouse.x * 0.4;
    group.position.y = -mouse.y * 0.3 + scroll * 1.5;
    group.rotation.z = scroll * Math.PI * 0.6;
    camera.position.z = 9 - scroll * 3 - burst * 2;
    camera.lookAt(group.position.x * 0.3, 0, 0);

    const p = pGeo.attributes.position.array;
    const v = dt * 8 * speed * k * (1 + burst * 10);
    for (let i = 2; i < p.length; i += 3) {
      p[i] += v;
      if (p[i] > 12) p[i] -= 130;
    }
    pGeo.attributes.position.needsUpdate = true;
    particles.rotation.z += dt * 0.03;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();

  return {
    setAccent(hex) { target.set(hex); },
    pulse() { burst = 1; },
  };
}
