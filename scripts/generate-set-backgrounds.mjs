// Generates the 12 themed verse-set background SVGs into
// public/set-backgrounds/. Same spirit as the dailyverse backgrounds:
// layered gradients + a simple symbolic scene per theme. Re-run any time:
//   node scripts/generate-set-backgrounds.mjs
// Individual themes can later be replaced with AI-generated JPG/PNGs by
// pointing src/setBackgrounds.js at the new file.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'set-backgrounds');
mkdirSync(outDir, { recursive: true });

const svg = (label, defs, body) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}">
  <defs>${defs}</defs>
${body}
</svg>
`;

const linear = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const radial = (id, cx, cy, r, stops) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;

const themes = {
  // 兒童 — bright morning sky, sun, floating balloons
  children: svg('Children background', [
    linear('sky', [[0, '#7dd3fc'], [0.6, '#bae6fd'], [1, '#fef9c3']]),
    radial('sun', '78%', '20%', '30%', [[0, '#fde047', 0.95], [0.5, '#fbbf24', 0.45], [1, '#fbbf24', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#sun)"/>
  <circle cx="330" cy="330" r="46" fill="#f472b6" opacity="0.85"/>
  <circle cx="430" cy="250" r="34" fill="#60a5fa" opacity="0.85"/>
  <circle cx="510" cy="350" r="28" fill="#4ade80" opacity="0.85"/>
  <path d="M330 376 q6 60 24 96 M430 284 q2 60 14 110 M510 378 q0 50 8 90" stroke="#64748b" stroke-width="3" fill="none" opacity="0.5"/>
  <ellipse cx="800" cy="960" rx="1100" ry="220" fill="#86efac" opacity="0.9"/>
  <ellipse cx="1350" cy="990" rx="800" ry="200" fill="#4ade80" opacity="0.7"/>`),

  // 長者 — warm amber dusk, gentle hills, big soft sun
  elderly: svg('Elderly background', [
    linear('sky', [[0, '#7c2d12'], [0.45, '#ea580c'], [0.8, '#fbbf24'], [1, '#fef3c7']]),
    radial('sun', '50%', '62%', '34%', [[0, '#fff7ed', 0.95], [0.5, '#fde68a', 0.5], [1, '#fde68a', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#sun)"/>
  <circle cx="800" cy="560" r="90" fill="#fffbeb" opacity="0.9"/>
  <ellipse cx="380" cy="930" rx="900" ry="260" fill="#92400e" opacity="0.85"/>
  <ellipse cx="1300" cy="980" rx="1000" ry="280" fill="#78350f" opacity="0.9"/>`),

  // 家庭 — warm evening, house with lit window
  family: svg('Family background', [
    linear('sky', [[0, '#312e81'], [0.55, '#7c3aed'], [1, '#fca5a5']]),
    radial('glow', '62%', '68%', '26%', [[0, '#fde68a', 0.75], [1, '#fde68a', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#glow)"/>
  <ellipse cx="800" cy="1010" rx="1200" ry="280" fill="#1e1b4b" opacity="0.9"/>
  <g transform="translate(900,540)">
    <rect x="0" y="60" width="220" height="160" rx="6" fill="#1e293b"/>
    <path d="M-20 70 L110 -30 L240 70 Z" fill="#334155"/>
    <rect x="86" y="120" width="52" height="64" rx="4" fill="#fde047" opacity="0.95"/>
  </g>
  <circle cx="330" cy="200" r="5" fill="#fff" opacity="0.8"/>
  <circle cx="450" cy="140" r="3.5" fill="#fff" opacity="0.7"/>
  <circle cx="240" cy="300" r="3" fill="#fff" opacity="0.6"/>`),

  // 十字架 — dawn hill, cross silhouette
  cross: svg('Cross background', [
    linear('sky', [[0, '#1e1b4b'], [0.5, '#6d28d9'], [0.85, '#f59e0b'], [1, '#fde68a']]),
    radial('dawn', '50%', '78%', '40%', [[0, '#fef3c7', 0.9], [1, '#fef3c7', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#dawn)"/>
  <ellipse cx="800" cy="1000" rx="1150" ry="270" fill="#292524" opacity="0.95"/>
  <g transform="translate(800,470)" fill="#1c1917">
    <rect x="-16" y="-190" width="32" height="330" rx="6"/>
    <rect x="-105" y="-110" width="210" height="30" rx="6"/>
  </g>`),

  // 自然・創造 — green mountains, river
  nature: svg('Nature background', [
    linear('sky', [[0, '#0ea5e9'], [0.6, '#7dd3fc'], [1, '#ecfccb']]),
    linear('river', [[0, '#bae6fd'], [1, '#38bdf8']]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <path d="M0 560 L320 300 L640 560 Z" fill="#166534" opacity="0.85"/>
  <path d="M420 600 L820 260 L1240 600 Z" fill="#15803d" opacity="0.9"/>
  <path d="M1000 620 L1360 340 L1600 560 L1600 640 Z" fill="#166534" opacity="0.8"/>
  <ellipse cx="800" cy="1000" rx="1200" ry="300" fill="#4d7c0f" opacity="0.9"/>
  <path d="M700 900 C 760 780 900 740 1050 700 C 1180 668 1290 660 1400 664 L1400 900 Z" fill="url(#river)" opacity="0.85"/>`),

  // 醫治 — soft teal radiance
  healing: svg('Healing background', [
    linear('sky', [[0, '#134e4a'], [0.55, '#0d9488'], [1, '#99f6e4']]),
    radial('halo', '50%', '42%', '38%', [[0, '#ccfbf1', 0.95], [0.6, '#5eead4', 0.4], [1, '#5eead4', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#halo)"/>
  <circle cx="800" cy="378" r="120" fill="none" stroke="#f0fdfa" stroke-width="3" opacity="0.5"/>
  <circle cx="800" cy="378" r="180" fill="none" stroke="#f0fdfa" stroke-width="2" opacity="0.3"/>
  <ellipse cx="800" cy="1010" rx="1200" ry="270" fill="#115e59" opacity="0.85"/>`),

  // 平安 — still waters, moonlight reflection
  peace: svg('Peace background', [
    linear('sky', [[0, '#0f172a'], [0.6, '#1e3a8a'], [1, '#334155']]),
    linear('sea', [[0, '#1e40af'], [1, '#0f172a']]),
  ].join(''), `
  <rect width="1600" height="620" fill="url(#sky)"/>
  <rect y="620" width="1600" height="280" fill="url(#sea)"/>
  <circle cx="1120" cy="250" r="70" fill="#e2e8f0" opacity="0.95"/>
  <g stroke="#cbd5e1" opacity="0.5">
    <line x1="1040" y1="660" x2="1200" y2="660" stroke-width="5"/>
    <line x1="1070" y1="700" x2="1180" y2="700" stroke-width="4"/>
    <line x1="1050" y1="745" x2="1190" y2="745" stroke-width="3"/>
    <line x1="1085" y1="790" x2="1165" y2="790" stroke-width="3"/>
  </g>
  <circle cx="360" cy="160" r="3" fill="#fff" opacity="0.7"/>
  <circle cx="520" cy="90" r="2.5" fill="#fff" opacity="0.6"/>
  <circle cx="700" cy="200" r="2" fill="#fff" opacity="0.5"/>`),

  // 敬拜・讚美 — royal purple, rising light rays
  worship: svg('Worship background', [
    linear('sky', [[0, '#2e1065'], [0.55, '#7c3aed'], [1, '#c026d3']]),
    radial('burst', '50%', '88%', '55%', [[0, '#f5d0fe', 0.9], [0.55, '#d946ef', 0.35], [1, '#d946ef', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#burst)"/>
  <g fill="#f5d0fe" opacity="0.35">
    <path d="M800 900 L700 0 L760 0 L820 900 Z"/>
    <path d="M800 900 L940 40 L1000 60 L860 900 Z"/>
    <path d="M800 900 L520 80 L580 50 L840 900 Z"/>
    <path d="M800 900 L1180 160 L1230 200 L860 900 Z"/>
    <path d="M800 900 L360 260 L400 210 L840 900 Z"/>
  </g>`),

  // 禱告 — night sky, candle glow
  prayer: svg('Prayer background', [
    linear('sky', [[0, '#020617'], [0.6, '#1e1b4b'], [1, '#312e81']]),
    radial('candle', '50%', '74%', '30%', [[0, '#fde68a', 0.95], [0.5, '#f59e0b', 0.4], [1, '#f59e0b', 0]]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#candle)"/>
  <rect x="770" y="700" width="60" height="140" rx="10" fill="#fef3c7" opacity="0.9"/>
  <ellipse cx="800" cy="672" rx="16" ry="30" fill="#fde047"/>
  <ellipse cx="800" cy="662" rx="8" ry="16" fill="#fff7ed"/>
  <circle cx="300" cy="150" r="3" fill="#fff" opacity="0.8"/>
  <circle cx="470" cy="90" r="2" fill="#fff" opacity="0.6"/>
  <circle cx="1180" cy="130" r="3" fill="#fff" opacity="0.7"/>
  <circle cx="1330" cy="240" r="2" fill="#fff" opacity="0.6"/>
  <circle cx="1050" cy="70" r="2.5" fill="#fff" opacity="0.7"/>`),

  // 光・興起發光 — golden radial burst
  light: svg('Light background', [
    radial('core', '50%', '46%', '70%', [[0, '#fffbeb'], [0.3, '#fde047'], [0.65, '#f59e0b'], [1, '#b45309']]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#core)"/>
  <g fill="#fffbeb" opacity="0.45">
    <path d="M800 414 L60 120 L90 80 L810 400 Z"/>
    <path d="M800 414 L1520 100 L1550 150 L812 402 Z"/>
    <path d="M800 414 L780 -60 L840 -60 L820 400 Z"/>
    <path d="M800 414 L200 860 L170 810 L790 420 Z"/>
    <path d="M800 414 L1420 850 L1450 800 L812 420 Z"/>
  </g>`),

  // 豐收・果實 — wheat field at golden hour
  harvest: svg('Harvest background', [
    linear('sky', [[0, '#fbbf24'], [0.55, '#fcd34d'], [1, '#fef3c7']]),
    linear('field', [[0, '#d97706'], [1, '#92400e']]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <circle cx="1200" cy="240" r="86" fill="#fff7ed" opacity="0.95"/>
  <rect y="600" width="1600" height="300" fill="url(#field)"/>
  <g stroke="#78350f" stroke-width="6" fill="none" opacity="0.85">
    <path d="M240 900 V 660 M240 700 q-40 -30 -44 -70 M240 700 q40 -30 44 -70 M240 760 q-36 -26 -40 -62 M240 760 q36 -26 40 -62"/>
    <path d="M480 900 V 620 M480 660 q-40 -30 -44 -70 M480 660 q40 -30 44 -70 M480 720 q-36 -26 -40 -62 M480 720 q36 -26 40 -62"/>
    <path d="M720 900 V 650 M720 690 q-40 -30 -44 -70 M720 690 q40 -30 44 -70 M720 750 q-36 -26 -40 -62 M720 750 q36 -26 40 -62"/>
  </g>`),

  // 牧人・詩篇23 — green pastures, sheep
  shepherd: svg('Shepherd background', [
    linear('sky', [[0, '#38bdf8'], [0.65, '#bae6fd'], [1, '#f0fdf4']]),
  ].join(''), `
  <rect width="1600" height="900" fill="url(#sky)"/>
  <circle cx="320" cy="180" r="60" fill="#fff" opacity="0.9"/>
  <ellipse cx="380" cy="200" rx="80" ry="46" fill="#fff" opacity="0.9"/>
  <ellipse cx="1200" cy="150" rx="90" ry="40" fill="#fff" opacity="0.8"/>
  <ellipse cx="500" cy="980" rx="1000" ry="360" fill="#4ade80" opacity="0.9"/>
  <ellipse cx="1400" cy="1020" rx="900" ry="380" fill="#22c55e" opacity="0.85"/>
  <g>
    <ellipse cx="1050" cy="700" rx="52" ry="34" fill="#f8fafc"/>
    <circle cx="1105" cy="686" r="18" fill="#334155"/>
    <rect x="1020" y="726" width="8" height="26" fill="#334155"/><rect x="1062" y="726" width="8" height="26" fill="#334155"/>
    <ellipse cx="880" cy="760" rx="40" ry="26" fill="#f8fafc"/>
    <circle cx="922" cy="750" r="14" fill="#334155"/>
    <rect x="858" y="780" width="6" height="20" fill="#334155"/><rect x="892" y="780" width="6" height="20" fill="#334155"/>
  </g>`),
};

for (const [id, content] of Object.entries(themes)) {
  writeFileSync(join(outDir, `${id}.svg`), content);
  console.log(`✓ ${id}.svg`);
}
console.log(`\n${Object.keys(themes).length} backgrounds → public/set-backgrounds/`);
