// Draws the isometric factory in the home page's "How it works" panel and writes it into index.html, between the
// "factory:start" and "factory:end" comments. Run `node scripts/factory.mjs` after changing the layout here;
// `node scripts/factory.mjs --check` only reports whether index.html is up to date (the e2e check `motion` runs it).
// The scene is a 2:1 isometric grid: one tile is 100 wide and 50 tall on screen, and heights are in screen pixels.
// site.js moves the tickets along the belt, using the path and stops written on the <svg> as data attributes.
import fs from 'node:fs';

const r = (n) => Math.round(n * 10) / 10;
const P = (gx, gy, z = 0) => [r((gx - gy) * 50), r((gx + gy) * 25 - z)];
const pts = (list) => list.map((p) => p.join(',')).join(' ');
const poly = (list, attrs = '') => `<polygon points="${pts(list)}" ${attrs}/>`;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');

const INK = '#070818';
// A box from its three visible faces: top, the face towards the viewer's left (gy = y1) and the one to the right (gx = x1).
function box(x0, x1, y0, y1, z0, z1, color, cls = '') {
  const c = cls ? ` class="${cls}"` : '';
  return `<g${c}>` +
    poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], `fill="${color}"`) +
    poly([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)], `fill="${mix(color, INK, 0.38)}"`) +
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], `fill="${mix(color, '#ffffff', 0.22)}"`) +
    '</g>';
}
// A rectangle painted on a left face (u along gx, v up) or a right face (u along gy, v up).
const onLeft = (x0, y1, u0, u1, v0, v1, attrs) => poly([P(x0 + u0, y1, v1), P(x0 + u1, y1, v1), P(x0 + u1, y1, v0), P(x0 + u0, y1, v0)], attrs);
const onRight = (x1, y0, u0, u1, v0, v1, attrs) => poly([P(x1, y0 + u0, v1), P(x1, y0 + u1, v1), P(x1, y0 + u1, v0), P(x1, y0 + u0, v0)], attrs);

const ROW_A = 1, ROW_B = 7, TURN = 9, BELT = 0.32, BELT_H = 10, BODY_H = 80;
const COLS = [1.5, 4, 6.5];
const STATIONS = [
  { key: 'plan', name: 'Plan', color: '#7d74ff', gx: COLS[0], row: ROW_A },
  { key: 'build', name: 'Build', color: '#9b6bff', gx: COLS[1], row: ROW_A },
  { key: 'review', name: 'Review', color: '#c56cf0', gx: COLS[2], row: ROW_A },
  { key: 'qa', name: 'QA', color: '#f27aa9', gx: COLS[2], row: ROW_B },
  { key: 'approval', name: 'Approval', color: '#ffb454', gx: COLS[1], row: ROW_B },
  { key: 'deploy', name: 'Deploy', color: '#ff8a6a', gx: COLS[0], row: ROW_B },
];

// What stands on each machine's roof. (cx, cy) is the roof's centre.
function topper(s, cx, cy) {
  const [x, y] = P(cx, cy, BODY_H);
  if (s.key === 'plan') return `<path d="M${x} ${y}v-30" stroke="#b9b6ff" stroke-width="3"/><path d="M${x - 15} ${y - 36}q15 16 30 0z" fill="#d9d7ff"/><circle class="fm-lamp" cx="${x}" cy="${y - 40}" r="4.5"/>`;
  if (s.key === 'build') return box(cx - 0.2, cx + 0.12, cy - 0.3, cy + 0.02, BODY_H, BODY_H + 30, mix(s.color, INK, 0.25)) +
    `<g transform="translate(${x - 32} ${y - 4})"><g class="fm-gear"><path d="M0-13V13M-13 0H13M-9-9 9 9M-9 9 9-9" stroke="#e7dcff" stroke-width="5"/><circle r="8" fill="#e7dcff"/><circle r="3" fill="${INK}" stroke="none"/></g></g>`;
  if (s.key === 'review') return `<ellipse cx="${x}" cy="${y - 8}" rx="25" ry="19" fill="#f6eaff"/><g class="fm-pupil"><circle cx="${x}" cy="${y - 7}" r="10" fill="#3a1d5c"/><circle cx="${x + 3}" cy="${y - 11}" r="3" fill="#fff" stroke="none"/></g>`;
  if (s.key === 'qa') return [-0.34, 0, 0.34].map((d, i) => { const [lx, ly] = P(cx + d, cy + 0.1, BODY_H); return `<path d="M${lx} ${ly}v-9" stroke="#ffd3e2" stroke-width="3"/><circle class="fm-check fm-check-${i}" cx="${lx}" cy="${ly - 13}" r="7"/>`; }).join('');
  if (s.key === 'approval') return `<path d="M${x} ${y}v-12" stroke="#ffe2b8" stroke-width="3"/><rect x="${x - 10}" y="${y - 48}" width="20" height="38" rx="7" fill="#2a2244"/><circle class="fm-stop" cx="${x}" cy="${y - 38}" r="5.5"/><circle class="fm-go" cx="${x}" cy="${y - 21}" r="5.5"/>`;
  return `<path d="M${x} ${y}v-22" stroke="#ffd0c2" stroke-width="3"/><path class="fm-flag" d="M${x} ${y - 38}h22l-6 8 6 8h-22z" fill="#ffd27a"/><circle class="fm-lamp" cx="${x}" cy="${y - 2}" r="4"/>`;
}

// Lettering that lies flat on the floor, reading along the belt.
const decal = (gx, gy, text, cls = 'factory-decal') => { const [x, y] = P(gx, gy); return `<text class="${cls}" transform="matrix(1 0.5 -1 0.5 ${x} ${y})">${text}</text>`; };

function machine(s, i) {
  const x0 = s.gx - 0.55, x1 = s.gx + 0.55, y1 = s.row - 0.65, y0 = y1 - 1;
  const face = P(x0, y1, 0);
  const glow = P(s.gx, s.row, 0);
  const [sx, sy] = P(s.gx, (y0 + y1) / 2, BODY_H + 62);
  return `<g class="fm fm-${s.key}" data-m="${i}" style="--c:${s.color}">` +
    `<ellipse class="fm-glow" cx="${glow[0]}" cy="${glow[1]}" rx="74" ry="37"/>` +
    box(x0, x1, y0, y1, 0, BODY_H, mix(s.color, '#1b1a4a', 0.28)) +
    // The window on the right face lights up while the machine works.
    onRight(x1, y0, 0.2, 0.8, 30, 58, 'class="fm-window"') +
    onLeft(x0, y1, 0, 1.1, 0, 9, `fill="${INK}" opacity="0.45" stroke="none"`) +
    `<g transform="matrix(1 0.5 0 1 ${face[0]} ${face[1]})"><rect x="9.5" y="-58" width="36" height="36" rx="8" fill="${INK}" opacity="0.5" stroke="none"/><use class="fm-icon" href="#fi-${i + 1}" x="15.5" y="-52" width="24" height="24"/></g>` +
    // The arm that reaches over the belt.
    box(s.gx - 0.36, s.gx + 0.36, y1, s.row + 0.3, BODY_H, BODY_H + 14, mix(s.color, '#ffffff', 0.12)) +
    topper(s, s.gx, (y0 + y1) / 2) +
    `<g class="fm-sign"><path d="M${sx} ${sy + 16}v14" stroke="#8f8cc0" stroke-width="2.5"/><circle cx="${sx}" cy="${sy}" r="18"/><text x="${sx}" y="${sy + 7.5}" text-anchor="middle">${i + 1}</text></g>` +
    decal(s.gx - 0.8, s.row + 1.0, s.name.toUpperCase(), 'fm-name') +
    '</g>';
}
// Drawn over the tickets: the light each arm throws on the belt, and the steam from Build's chimney.
function effects(s, i) {
  const [x, top] = P(s.gx, s.row, BODY_H), bottom = top + BODY_H - BELT_H;
  let out = `<g class="fx fx-${s.key}" data-m="${i}" style="--c:${s.color}"><polygon class="fx-beam" points="${x - 9},${top} ${x + 9},${top} ${x + 40},${bottom + 12} ${x - 40},${bottom + 12}"/>`;
  if (s.key === 'build') { const [px, py] = P(s.gx - 0.04, s.row - 1.34, BODY_H + 34); out += [0, 1, 2].map((n) => `<circle class="fx-puff fx-puff-${n}" cx="${px}" cy="${py}" r="9"/>`).join(''); }
  if (s.key === 'plan') out += `<path class="fx-scan" d="M${x - 26} ${bottom - 22}h52"/>`;
  return out + '</g>';
}

function ticket(stop, form, id, at) {
  const h = 0.27, z = 27, [x, y] = at;
  const L = (gx, gy, zz = 0) => P(gx, gy, zz);
  return `<g class="crate" data-form="${form}" data-stop="${stop}" transform="translate(${x} ${y})"><g class="crate-in">` +
    `<path class="crate-flame" d="M-11 2q11 34 22 0q-11 9-22 0z"/>` +
    `<g class="crate-box">${poly([L(-h, h, z), L(h, h, z), L(h, h), L(-h, h)])}${poly([L(h, -h, z), L(h, h, z), L(h, h), L(h, -h)])}${poly([L(-h, -h, z), L(h, -h, z), L(h, h, z), L(-h, h, z)])}</g>` +
    poly([L(h, -h, z), L(h, h, z), L(h, h), L(h, -h)], 'fill="#000" opacity="0.34" stroke="none"') +
    poly([L(-h, -h, z), L(h, -h, z), L(h, h, z), L(-h, h, z)], 'fill="#fff" opacity="0.2" stroke="none"') +
    `<path d="M${pts([L(0, -h, z)])}L${pts([L(0, h, z)])}L${pts([L(0, h, z - 9)])}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="5"/>` +
    `<g class="crate-tag"><rect x="-27" y="-63" width="54" height="17" rx="8.5"/><text y="-50.5" text-anchor="middle">${id}</text></g>` +
    '</g></g>';
}

// The belt's centre line, with the distance travelled (in tiles) at each corner, and where the tickets stop.
const SIDE = ROW_B - ROW_A, END = TURN + 0.5 + SIDE + TURN + 0.5;
const PATH = [[-0.5, ROW_A, 0], [TURN, ROW_A, TURN + 0.5], [TURN, ROW_B, TURN + 0.5 + SIDE], [-0.5, ROW_B, END]];
const STOPS = [0, ...COLS.map((c) => c + 0.5), TURN + 0.5, TURN + 0.5 + SIDE / 2, TURN + 0.5 + SIDE, ...COLS.map((c) => END - 0.5 - c).reverse(), END];
const MACHINE_STOPS = [1, 2, 3, 7, 8, 9];
function at(d) {
  for (let i = 1; i < PATH.length; i++) {
    const [ax, ay, ad] = PATH[i - 1], [bx, by, bd] = PATH[i];
    if (d <= bd) { const t = (d - ad) / (bd - ad); return P(ax + (bx - ax) * t, ay + (by - ay) * t, BELT_H); }
  }
  return P(PATH[3][0], PATH[3][1], BELT_H);
}

const floor = { x0: -1.4, x1: 10.1, y0: -1.4, y1: 8.6 };
let grid = '';
for (let g = 0; g <= 10; g++) grid += `M${pts([P(g, floor.y0)])}L${pts([P(g, floor.y1)])}`;
for (let g = -1; g <= 8; g++) grid += `M${pts([P(floor.x0, g)])}L${pts([P(floor.x1, g)])}`;
const beltTop = '#262a66';
const line = PATH.map((p) => P(p[0], p[1], BELT_H).join(',')).join(' ');
const pad = P(-0.5, ROW_B, 0), gate = STATIONS[4];

const svg = `<svg class="factory-svg" viewBox="-515 -165 1105 665" data-path="${PATH.map((p) => [...P(p[0], p[1], BELT_H), p[2]].join(',')).join(';')}" data-stops="${STOPS.join(',')}" data-machines="${MACHINE_STOPS.join(',')}">
<defs>
<symbol id="fi-1" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 8h3M9 12h7M9 16h7"/></symbol>
<symbol id="fi-2" viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/></symbol>
<symbol id="fi-3" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="fi-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></symbol>
<symbol id="fi-5" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></symbol>
<symbol id="fi-6" viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></symbol>
</defs>
<g class="factory-ink">
${box(floor.x0, floor.x1, floor.y0, floor.y1, -26, 0, '#1a1c4c', 'factory-slab')}
<path class="factory-grid" d="${grid}"/>
${decal(-1.2, 2.0, 'TICKETS')}${decal(-1.2, ROW_B + 1.0, 'LIVE')}
${box(7.2, 7.9, 3.4, 4.1, 0, 30, '#3b3f86')}${box(7.3, 7.8, 3.5, 4, 30, 50, '#4a4f9c')}
<g class="factory-pad"><ellipse cx="${pad[0]}" cy="${pad[1]}" rx="50" ry="25"/><ellipse cx="${pad[0]}" cy="${pad[1]}" rx="32" ry="16"/></g>
${box(-0.5, TURN + BELT, ROW_A - BELT, ROW_A + BELT, 0, BELT_H, beltTop)}
${box(TURN - BELT, TURN + BELT, ROW_A - BELT, ROW_B + BELT, 0, BELT_H, beltTop)}
${box(-0.5, TURN + BELT, ROW_B - BELT, ROW_B + BELT, 0, BELT_H, beltTop)}
<polyline class="factory-dash" points="${line}"/>
${box(-1.15, -0.2, ROW_A - 0.55, ROW_A + 0.55, 0, 52, '#4a4f9c')}
${onRight(-0.2, ROW_A - 0.55, 0.2, 0.9, 6, 38, `fill="${INK}"`)}
${[0, 1, 2, 5, 4, 3].map((i) => machine(STATIONS[i], i)).join('\n')}
<g class="fm-barrier" data-m="4">${poly([P(gate.gx - 0.72, ROW_B - 0.5, 34), P(gate.gx - 0.72, ROW_B + 0.5, 34), P(gate.gx - 0.72, ROW_B + 0.5, 24), P(gate.gx - 0.72, ROW_B - 0.5, 24)])}<path d="M${pts([P(gate.gx - 0.72, ROW_B - 0.5, 34)])}V${P(gate.gx - 0.72, ROW_B - 0.5, 0)[1]}" stroke-width="4"/></g>
</g>
<g class="factory-ink factory-tickets">
${[[9, 5, 'SHOP-7'], [7, 3, 'SHOP-8'], [5, 3, 'SHOP-9'], [3, 2, 'SHOP-10'], [1, 0, 'SHOP-11']].map(([stop, form, id]) => ticket(stop, form, id, at(STOPS[stop]))).join('\n')}
</g>
<g class="factory-fx">
${STATIONS.map(effects).join('\n')}
</g>
</svg>`;

const file = new URL('../index.html', import.meta.url);
const html = fs.readFileSync(file, 'utf8');
const a = html.indexOf('<!-- factory:start -->'), b = html.indexOf('<!-- factory:end -->');
if (a < 0 || b < 0) throw new Error('factory markers not found in index.html');
const next = html.slice(0, a) + '<!-- factory:start -->\n' + svg + '\n            ' + html.slice(b);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('index.html is out of date: run node scripts/factory.mjs'); process.exit(1); }
} else {
  fs.writeFileSync(file, next);
  console.log('factory written:', svg.length, 'bytes');
}
