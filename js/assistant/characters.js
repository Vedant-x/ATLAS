// The assistant's looks. Each is an SVG (viewBox 0 0 120 120) with the same animated parts:
// .ai-body (floats), .ai-eyes (blink), .ai-pupils (follow the cursor), .ai-mouth (talks).
const eyes = (lx, rx, y, r = 7, pr = 3.4, white = '#fff', pupil = '#0a0a10') => `
  <g class="ai-eyes">
    <circle cx="${lx}" cy="${y}" r="${r}" fill="${white}"/><circle cx="${rx}" cy="${y}" r="${r}" fill="${white}"/>
    <g class="ai-pupils"><circle cx="${lx}" cy="${y}" r="${pr}" fill="${pupil}"/><circle cx="${rx}" cy="${y}" r="${pr}" fill="${pupil}"/>
      <circle cx="${lx + 1.6}" cy="${y - 1.6}" r="1.1" fill="#fff"/><circle cx="${rx + 1.6}" cy="${y - 1.6}" r="1.1" fill="#fff"/></g>
  </g>`;
const mouth = (x, y, w = 12, color = '#0a0a10') => `<path class="ai-mouth" d="M${x - w / 2} ${y} Q${x} ${y + w * 0.6} ${x + w / 2} ${y}" stroke="${color}" stroke-width="3" fill="${color}" fill-opacity=".25" stroke-linecap="round"/>`;

export const CHARACTERS = [
  { id: 'nova', name: 'Nova', tag: 'Energy orb', color: '#d2ff00', svg: `
    <defs><radialGradient id="g-nova" cx="40%" cy="35%"><stop offset="0" stop-color="#f4ffb0"/><stop offset=".55" stop-color="#d2ff00"/><stop offset="1" stop-color="#6f8a00"/></radialGradient></defs>
    <g class="ai-body">
      <ellipse class="ai-ring" cx="60" cy="62" rx="52" ry="14" fill="none" stroke="#d2ff00" stroke-width="2" opacity=".55"/>
      <circle cx="60" cy="58" r="36" fill="url(#g-nova)"/>
      <circle cx="47" cy="44" r="8" fill="#fff" opacity=".35"/>
      ${eyes(48, 72, 58)}${mouth(60, 72)}
    </g>` },
  { id: 'bolt', name: 'Bolt', tag: 'Robot', color: '#4fd1ff', svg: `
    <g class="ai-body">
      <line x1="60" y1="22" x2="60" y2="10" stroke="#9fb3c8" stroke-width="3"/><circle class="ai-antenna" cx="60" cy="9" r="5" fill="#4fd1ff"/>
      <rect x="22" y="22" width="76" height="66" rx="20" fill="#c9d6e3"/><rect x="28" y="30" width="64" height="44" rx="14" fill="#0e1a26"/>
      <rect x="14" y="44" width="10" height="20" rx="4" fill="#9fb3c8"/><rect x="96" y="44" width="10" height="20" rx="4" fill="#9fb3c8"/>
      ${eyes(46, 74, 50, 7, 3.6, '#4fd1ff', '#0e1a26')}
      <path class="ai-mouth" d="M48 64 Q60 70 72 64" stroke="#4fd1ff" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="40" y="92" width="40" height="14" rx="6" fill="#9fb3c8"/>
    </g>` },
  { id: 'kit', name: 'Kit', tag: 'Fox', color: '#ff8a3d', svg: `
    <g class="ai-body">
      <path d="M26 30 L38 62 L18 58 Z" fill="#ff8a3d"/><path d="M94 30 L82 62 L102 58 Z" fill="#ff8a3d"/>
      <path d="M28 36 L36 56 L24 54 Z" fill="#2a1408"/><path d="M92 36 L84 56 L96 54 Z" fill="#2a1408"/>
      <path d="M60 30 C88 30 100 52 98 70 C96 90 78 100 60 100 C42 100 24 90 22 70 C20 52 32 30 60 30 Z" fill="#ff8a3d"/>
      <path d="M60 64 C76 64 88 76 84 88 C78 98 42 98 36 88 C32 76 44 64 60 64 Z" fill="#fff4ea"/>
      ${eyes(46, 74, 60, 6.5)}<ellipse cx="60" cy="76" rx="5" ry="3.6" fill="#2a1408"/>${mouth(60, 83, 10, '#2a1408')}
    </g>` },
  { id: 'hoot', name: 'Hoot', tag: 'Owl', color: '#b08cff', svg: `
    <g class="ai-body">
      <path d="M30 34 L40 20 L48 34 Z" fill="#7a5cc4"/><path d="M90 34 L80 20 L72 34 Z" fill="#7a5cc4"/>
      <ellipse cx="60" cy="64" rx="40" ry="40" fill="#8f6ee0"/>
      <ellipse cx="60" cy="78" rx="24" ry="22" fill="#d9ccff"/>
      <circle cx="44" cy="54" r="15" fill="#efe9ff"/><circle cx="76" cy="54" r="15" fill="#efe9ff"/>
      ${eyes(44, 76, 54, 9, 5, '#ffd84d')}
      <path class="ai-mouth" d="M55 68 L60 77 L65 68 Z" fill="#ffb84d"/>
    </g>` },
  { id: 'boo', name: 'Boo', tag: 'Ghost', color: '#e8eefc', svg: `
    <g class="ai-body">
      <path d="M22 98 L22 56 C22 32 40 18 60 18 C80 18 98 32 98 56 L98 98 L88 90 L78 98 L68 90 L60 98 L52 90 L42 98 L32 90 Z" fill="#eef2ff"/>
      <ellipse cx="38" cy="66" rx="6" ry="4" fill="#ff8fb1" opacity=".55"/><ellipse cx="82" cy="66" rx="6" ry="4" fill="#ff8fb1" opacity=".55"/>
      ${eyes(46, 74, 54, 7, 4.2, '#1b1b2a', '#1b1b2a')}
      <ellipse class="ai-mouth" cx="60" cy="72" rx="6" ry="5" fill="#1b1b2a"/>
    </g>` },
  { id: 'ace', name: 'Ace', tag: 'Match ball', color: '#ff3d6e', svg: `
    <g class="ai-body">
      <circle cx="60" cy="60" r="40" fill="#f6f6f8"/>
      <path d="M60 36 L74 46 L69 62 L51 62 L46 46 Z" fill="#1a1a22"/>
      <path d="M60 20 L60 36 M74 46 L94 40 M69 62 L82 80 M51 62 L38 80 M46 46 L26 40" stroke="#1a1a22" stroke-width="3"/>
      <circle cx="60" cy="60" r="40" fill="none" stroke="#ff3d6e" stroke-width="4"/>
      <rect x="30" y="64" width="60" height="26" rx="13" fill="#f6f6f8"/>
      ${eyes(48, 72, 72, 5.5, 2.8)}${mouth(60, 82, 10)}
    </g>` },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
export const svgOf = (c, cls = '') => `<svg class="ai-char ${cls}" viewBox="0 0 120 120" aria-hidden="true" style="--ai:${c.color}">${c.svg}</svg>`;
