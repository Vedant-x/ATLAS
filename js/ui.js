// Interface motion: preloader, cursor, page wipe, magnetic elements, count-ups, scroll reveals, ticker.
const gsap = () => window.gsap;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;

export function preloader(promise) {
  const el = document.getElementById('preloader');
  if (!el) return promise;
  const num = el.querySelector('[data-count]');
  const bar = el.querySelector('.pl-bar i');
  let shown = 0, target = 0, done = false;
  const steps = setInterval(() => { target = Math.min(done ? 100 : 92, target + Math.random() * 9); }, 140);
  const loop = () => {
    shown += (target - shown) * 0.12;
    num.textContent = String(Math.round(shown)).padStart(3, '0');
    bar.style.transform = `scaleX(${shown / 100})`;
    if (shown < 99.5) requestAnimationFrame(loop);
  };
  loop();
  return promise.then((v) => {
    done = true; target = 100;
    return new Promise((res) => setTimeout(() => {
      clearInterval(steps);
      const g = gsap();
      if (g && !reduced) {
        g.timeline()
          .to('#preloader .pl-word span', { yPercent: -110, stagger: 0.04, duration: 0.6, ease: 'expo.in' })
          .to('#preloader', { clipPath: 'inset(0 0 100% 0)', duration: 1, ease: 'expo.inOut' }, '-=0.1')
          .add(() => { el.remove(); res(v); }, '-=0.45');
      } else { el.remove(); res(v); }
    }, 150));
  });
}

export function cursor() {
  if (!fine || reduced) return;
  const dot = document.createElement('div'); dot.className = 'cur-dot';
  const ring = document.createElement('div'); ring.className = 'cur-ring'; ring.innerHTML = '<span></span>';
  document.body.append(dot, ring);
  document.body.classList.add('has-cursor');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px)`; });
  (function loop() {
    rx += (x - rx) * 0.16; ry += (y - ry) * 0.16;
    ring.style.transform = `translate(${rx}px,${ry}px)`;
    requestAnimationFrame(loop);
  })();
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('a, button, [data-cursor], input, select');
    ring.classList.toggle('hover', !!t);
    ring.querySelector('span').textContent = t?.dataset.cursor || '';
    ring.classList.toggle('label', !!t?.dataset.cursor);
  });
  addEventListener('pointerdown', () => ring.classList.add('down'));
  addEventListener('pointerup', () => ring.classList.remove('down'));
}

// Full-screen wipe between pages. `swap` runs while the screen is covered.
export function wipe(swap, label = '') {
  const el = document.getElementById('wipe');
  const g = gsap();
  if (!el || !g || reduced) { swap(); return Promise.resolve(); }
  el.querySelector('b').textContent = label;
  return new Promise((res) => {
    g.timeline()
      .set(el, { display: 'flex', clipPath: 'inset(100% 0 0 0)' })
      .to(el, { clipPath: 'inset(0% 0 0 0)', duration: 0.55, ease: 'expo.in' })
      .fromTo(el.querySelector('b'), { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.3, ease: 'expo.out' }, '-=0.15')
      .add(() => swap())
      .to(el, { clipPath: 'inset(0 0 100% 0)', duration: 0.7, ease: 'expo.inOut' }, '+=0.05')
      .set(el, { display: 'none' })
      .add(res, '-=0.5');
  });
}

export function magnetic(root = document) {
  if (!fine || reduced) return;
  root.querySelectorAll('[data-magnetic]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

// 3D tilt + spotlight on .tilt cards
export function tilt() {
  if (!fine || reduced) return;
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.tilt');
    document.querySelectorAll('.tilt.on').forEach((c) => { if (c !== card) { c.classList.remove('on'); c.style.transform = ''; } });
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.classList.add('on');
    card.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(6px)`;
    card.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    card.style.setProperty('--my', `${(y + 0.5) * 100}%`);
  });
}

export function countUp(root = document) {
  root.querySelectorAll('[data-count-to]').forEach((el) => {
    const end = Number(el.dataset.countTo), dec = Number(el.dataset.dec || 0), suffix = el.dataset.suffix || '';
    if (reduced || !gsap()) { el.textContent = end.toFixed(dec) + suffix; return; }
    const o = { v: 0 };
    gsap().to(o, { v: end, duration: 1.6, ease: 'expo.out', delay: 0.2, onUpdate: () => { el.textContent = o.v.toFixed(dec) + suffix; } });
  });
}

// Reveal on scroll (IntersectionObserver), with headline letter animation on first paint.
let io;
export function reveal(root = document, animateTitle = true) {
  const g = gsap();
  if (animateTitle && g && !reduced) {
    g.fromTo(root.querySelectorAll('.hero .ch'), { yPercent: 115, rotateX: -80, opacity: 0 },
      { yPercent: 0, rotateX: 0, opacity: 1, duration: 1.1, stagger: 0.022, ease: 'expo.out', delay: 0.05 });
  } else root.querySelectorAll('.ch').forEach((c) => { c.style.opacity = 1; });
  io?.disconnect();
  io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  root.querySelectorAll('.reveal, .grow, .grow-y, .draw').forEach((el, i) => {
    el.style.setProperty('--d', `${Math.min(i % 12, 11) * 45}ms`);
    if (reduced) el.classList.add('in'); else io.observe(el);
  });
}

export function split(text) {
  return String(text).split(' ').map((w) => `<span class="word">${[...w].map((c) => `<span class="ch">${c.replace(/[&<>"']/g, (x) => `&#${x.charCodeAt(0)};`)}</span>`).join('')}</span>`).join(' ');
}
