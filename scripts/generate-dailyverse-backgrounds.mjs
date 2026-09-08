import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'public', 'dailyverse');

const scenes = [
  ['dawn-valley', 202, 38, 'M0 560 C190 410 310 405 480 510 C650 615 760 335 950 450 C1110 545 1270 392 1600 350'],
  ['river-light', 188, 47, 'M0 570 C220 430 360 470 520 560 C700 660 840 430 1010 540 C1190 650 1340 470 1600 510'],
  ['olive-hills', 128, 42, 'M0 525 C220 395 350 430 540 500 C720 565 875 315 1080 420 C1270 520 1420 405 1600 360'],
  ['desert-mercy', 36, 58, 'M0 590 C210 520 345 470 520 535 C720 610 850 500 1030 545 C1240 598 1390 482 1600 500'],
  ['night-peace', 224, 40, 'M0 540 C210 370 380 440 560 505 C710 560 845 330 1030 430 C1210 528 1390 382 1600 395'],
  ['gold-field', 52, 66, 'M0 600 C250 520 410 520 620 590 C810 654 960 520 1120 582 C1310 650 1445 548 1600 560'],
  ['rainbow-cove', 166, 52, 'M0 545 C210 420 370 420 540 520 C720 630 820 390 1000 475 C1220 578 1400 398 1600 380']
];

function wave(seed, index, min, max) {
  const value = Math.sin((seed + 1) * (index + 3) * 12.9898) * 43758.5453;
  const ratio = value - Math.floor(value);
  return min + ratio * (max - min);
}

function pointCloud(seed, count, radius, opacity) {
  return Array.from({ length: count }, (_, index) => {
    const cx = wave(seed, index * 2, 40, 1560).toFixed(1);
    const cy = wave(seed, index * 2 + 1, 40, 520).toFixed(1);
    const r = wave(seed, index * 3 + 7, radius * 0.25, radius).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${opacity}"/>`;
  }).join('');
}

function lightBeams(seed) {
  return Array.from({ length: 4 }, (_, index) => {
    const y = wave(seed, index, 80, 260).toFixed(0);
    const height = wave(seed, index + 10, 50, 110).toFixed(0);
    const opacity = wave(seed, index + 20, 0.08, 0.18).toFixed(2);
    return `<path d="M900 ${y} L1600 ${Math.max(0, y - 120)} L1600 ${Number(y) + Number(height)} L930 ${Number(y) + Number(height) + 80} Z" fill="white" opacity="${opacity}" filter="url(#soften)"/>`;
  }).join('');
}

function makeSvg(day) {
  const [name, hue, warmth, ridge] = scenes[(day - 1) % scenes.length];
  const shift = (day * 17) % 360;
  const base = (hue + shift) % 360;
  const accent = (base + warmth) % 360;
  const deep = (base + 210) % 360;
  const glow = (base + 72) % 360;
  const mirror = day % 2 === 0 ? 'scale(-1 1) translate(-1600 0)' : '';
  const moon = day % 5 === 0;
  const foreground = day % 3 === 0 ? 'trees' : day % 3 === 1 ? 'reeds' : 'stones';
  const riverX = 700 + (day % 5) * 34;

  const foregroundShapes = foreground === 'trees'
    ? `<g opacity="0.5" fill="hsl(${deep}, 52%, 12%)"><path d="M122 760 l42 -115 l40 115z"/><rect x="158" y="735" width="13" height="80"/><path d="M1388 746 l58 -162 l55 162z"/><rect x="1436" y="710" width="16" height="100"/></g>`
    : foreground === 'reeds'
      ? `<g fill="none" stroke="hsl(${glow}, 88%, 78%)" stroke-width="4" opacity="0.35"><path d="M116 900 C130 820 126 780 160 714"/><path d="M143 900 C152 836 172 790 205 742"/><path d="M1400 900 C1416 826 1418 782 1465 720"/><path d="M1450 900 C1470 838 1508 800 1540 750"/></g>`
      : `<g fill="hsl(${deep}, 42%, 14%)" opacity="0.42"><ellipse cx="140" cy="846" rx="95" ry="26"/><ellipse cx="1328" cy="830" rx="125" ry="32"/><ellipse cx="1510" cy="862" rx="72" ry="20"/></g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="DailyVerse background ${day}: ${name}">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="hsl(${base}, 56%, 25%)"/>
      <stop offset="0.44" stop-color="hsl(${accent}, 78%, 54%)"/>
      <stop offset="1" stop-color="hsl(${deep}, 64%, 13%)"/>
    </linearGradient>
    <radialGradient id="sun" cx="${moon ? 28 : 70}%" cy="${moon ? 18 : 24}%" r="${moon ? 32 : 44}%">
      <stop offset="0" stop-color="hsl(${glow}, 100%, ${moon ? 92 : 82}%)" stop-opacity="${moon ? 0.76 : 0.94}"/>
      <stop offset="0.38" stop-color="hsl(${glow}, 92%, ${moon ? 72 : 62}%)" stop-opacity="0.42"/>
      <stop offset="1" stop-color="hsl(${deep}, 62%, 12%)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="river" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="hsl(${accent}, 88%, 78%)" stop-opacity="0.78"/>
      <stop offset="0.54" stop-color="hsl(${base}, 82%, 48%)" stop-opacity="0.52"/>
      <stop offset="1" stop-color="hsl(${deep}, 74%, 15%)" stop-opacity="0.96"/>
    </linearGradient>
    <filter id="soften"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.08"/></feComponentTransfer></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#sun)"/>
  <g transform="${mirror}">
    ${pointCloud(day, 16, 2.5, 0.22)}
    ${lightBeams(day)}
    <path d="${ridge} L1600 900 L0 900 Z" fill="hsl(${deep}, 55%, 18%)" opacity="0.72"/>
    <path d="M0 636 C230 495 405 530 590 620 C760 704 910 505 1095 595 C1265 674 1415 550 1600 575 L1600 900 L0 900 Z" fill="hsl(${base}, 54%, 19%)" opacity="0.70"/>
    <path d="M${riverX} 900 C${riverX + 30} 748 ${riverX + 65} 650 ${riverX + 140} 548 C${riverX + 210} 650 ${riverX + 250} 770 ${riverX + 340} 900 Z" fill="url(#river)" opacity="0.92"/>
    <path d="M${riverX + 28} 900 C${riverX + 72} 780 ${riverX + 110} 678 ${riverX + 150} 590 C${riverX + 198} 690 ${riverX + 242} 805 ${riverX + 305} 900 Z" fill="white" opacity="0.17" filter="url(#soften)"/>
    ${foregroundShapes}
  </g>
  <rect width="1600" height="900" filter="url(#grain)" opacity="0.5"/>
</svg>
`;
}

await mkdir(outDir, { recursive: true });

for (let day = 1; day <= 31; day += 1) {
  const name = `day-${String(day).padStart(2, '0')}.svg`;
  await writeFile(join(outDir, name), makeSvg(day), 'utf8');
}

console.log(`Generated 31 DailyVerse backgrounds in ${outDir}`);
