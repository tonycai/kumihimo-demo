/**
 * Original demo artwork for Kumihimo, drawn in code (no AI, no third-party art): Tsumugi, a paper-crane
 * courier with an indigo braided sash, over a rainy harbour town at dusk. Every scene is a pure
 * function of time `t` (seconds) and returns an SVG string; scripts/demo-assets/render.mjs turns them
 * into the files in public/samples/. A seeded generator keeps every frame reproducible.
 */

export const SIZE = 1024;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const PALETTES = {
  dusk: { top: "#16213f", mid: "#2c5566", low: "#e7a35a", far: "#22304f", near: "#141c33", window: "#ffd27d", lantern: "#e9653a" },
  night: { top: "#0e1530", mid: "#1d3550", low: "#b9713f", far: "#1a2643", near: "#0d1428", window: "#ffc463", lantern: "#ef5a33" },
};

const f = (n) => Math.round(n * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

function defs(p) {
  return `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${p.top}"/><stop offset="0.58" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.low}"/>
  </linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="#ffb35c" stop-opacity="0.85"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
  <radialGradient id="bokeh"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f3a4c"/><stop offset="1" stop-color="#0c1726"/></linearGradient>
  <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf7ee"/><stop offset="1" stop-color="#e6dccb"/></linearGradient>
</defs>`;
}

function sky() {
  return `<rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>`;
}

/** Rooflines with lit windows; `shift` scrolls them for parallax. */
function town(p, seed, baseY, height, color, shift = 0, windows = true) {
  const r = rng(seed);
  let x = -200 + (shift % 200);
  const parts = [];
  while (x < SIZE + 200) {
    const w = 70 + r() * 110;
    const h = height * (0.55 + r() * 0.6);
    const roof = r() < 0.5;
    const top = baseY - h;
    const shape = roof
      ? pts([[x, baseY], [x, top + 26], [x + w / 2, top - 18], [x + w, top + 26], [x + w, baseY]])
      : pts([[x, baseY], [x, top], [x + w, top], [x + w, baseY]]);
    parts.push(`<polygon points="${shape}" fill="${color}"/>`);
    if (windows) {
      for (let wy = top + 40; wy < baseY - 18; wy += 34) {
        for (let wx = x + 12; wx < x + w - 18; wx += 26) {
          if (r() < 0.38) parts.push(`<rect x="${f(wx)}" y="${f(wy)}" width="9" height="13" fill="${p.window}" opacity="${f(0.55 + r() * 0.45)}"/>`);
        }
      }
    }
    x += w + 6;
  }
  return parts.join("");
}

function lanterns(p, t, y, count, seed, sag = 26) {
  const r = rng(seed);
  const out = [`<path d="M -20 ${y} Q ${SIZE / 2} ${y + sag * 2} ${SIZE + 20} ${y}" stroke="#2a2a33" stroke-width="2" fill="none"/>`];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const x = u * SIZE;
    const cy = y + sag * 2 * 4 * u * (1 - u) * 0.5 + 22;
    const flicker = 0.75 + 0.25 * Math.sin(t * (5 + r() * 4) + i * 1.7);
    out.push(`<circle cx="${f(x)}" cy="${f(cy)}" r="52" fill="url(#glow)" opacity="${f(flicker * 0.7)}"/>`);
    out.push(`<ellipse cx="${f(x)}" cy="${f(cy)}" rx="15" ry="19" fill="${p.lantern}" opacity="${f(0.85 + 0.15 * flicker)}"/>`);
    out.push(`<rect x="${f(x - 7)}" y="${f(cy - 23)}" width="14" height="5" fill="#2a2a33"/><rect x="${f(x - 7)}" y="${f(cy + 18)}" width="14" height="5" fill="#2a2a33"/>`);
  }
  return out.join("");
}

function rain(t, seed, count = 140, speed = 900, opacity = 0.35) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x0 = r() * (SIZE + 200) - 100;
    const y0 = r() * SIZE;
    const len = 18 + r() * 26;
    const y = (y0 + t * speed * (0.8 + r() * 0.4)) % (SIZE + 60) - 30;
    const x = x0 - (y - y0) * 0.12;
    out.push(`<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - len * 0.12)}" y2="${f(y + len)}" stroke="#cfe1ff" stroke-opacity="${opacity}" stroke-width="1.6"/>`);
  }
  return out.join("");
}

/** The braided sash: alternating twisted strands, the kumihimo look. */
function braid(x1, y1, x2, y2, width, count) {
  const dx = (x2 - x1) / count;
  const dy = (y2 - y1) / count;
  const nx = (-dy / Math.hypot(dx, dy)) * width;
  const ny = (dx / Math.hypot(dx, dy)) * width;
  const colors = ["#2f3f9e", "#1f2a6b", "#d9963f"];
  const out = [`<polygon points="${pts([[x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny], [x1 + nx, y1 + ny]])}" fill="#1d265c"/>`];
  for (let i = 0; i < count; i++) {
    const ax = x1 + dx * i;
    const ay = y1 + dy * i;
    const c = colors[i % 3];
    out.push(`<polygon points="${pts([[ax - nx, ay - ny], [ax + dx * 0.9 - nx * 0.1, ay + dy * 0.9 - ny * 0.1], [ax + dx - nx * -0.9, ay + dy - ny * -0.9], [ax + dx * 0.1 + nx * 0.9, ay + dy * 0.1 + ny * 0.9]])}" fill="${c}"/>`);
  }
  return out.join("");
}

/**
 * Tsumugi, the paper crane, centred on (0,0) and about 360 px wide at scale 1. `flap` in -1..1
 * lifts or lowers the wings; `letter` hangs a sealed letter from the sash.
 */
export function crane({ x, y, scale = 1, flap = 0, letter = true, facing = 1, glints = 0, t = 0 }) {
  // Wings are broad triangles rising from the back; `flap` moves their apex between low and high.
  const lift = 0.35 + 0.65 * ((flap + 1) / 2);
  const farApex = [-40, -40 - 160 * lift];
  const nearApex = [30, -40 - 175 * lift];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const farBase = [[-58, -6], [48, -8]];
  const nearBase = [[-46, 0], [62, -2]];
  const shapes = [
    // far wing, in shadow, split along its fold
    `<polygon points="${pts([farBase[0], farApex, mid(farBase[0], farBase[1])])}" fill="#b9ad97"/>`,
    `<polygon points="${pts([mid(farBase[0], farBase[1]), farApex, farBase[1]])}" fill="#cfc4b1"/>`,
    // tail and neck rise from the body's ends; the head folds down
    `<polygon points="${pts([[44, 2], [172, -118], [160, -122], [30, 22]])}" fill="#e6dccb"/>`,
    `<polygon points="${pts([[-44, 2], [-166, -118], [-154, -124], [-30, 22]])}" fill="#f4eee2"/>`,
    `<polygon points="${pts([[-166, -118], [-196, -96], [-157, -110]])}" fill="#d6c9b2"/>`,
    // body
    `<polygon points="${pts([[-72, 4], [0, -24], [74, 4], [0, 40]])}" fill="url(#paper)"/>`,
    `<polygon points="${pts([[0, -24], [74, 4], [0, 40]])}" fill="#e2d8c6"/>`,
    // near wing, lit, split along its fold
    `<polygon points="${pts([nearBase[0], nearApex, mid(nearBase[0], nearBase[1])])}" fill="#fdfaf3"/>`,
    `<polygon points="${pts([mid(nearBase[0], nearBase[1]), nearApex, nearBase[1]])}" fill="#ebe2d1"/>`,
    `<polyline points="${pts([mid(nearBase[0], nearBase[1]), nearApex])}" stroke="#c4b8a1" stroke-width="1.5" fill="none"/>`,
    braid(-48, 10, 52, 22, 7, 10),
  ];
  if (letter) {
    shapes.push(
      `<line x1="4" y1="28" x2="6" y2="54" stroke="#1d265c" stroke-width="2.5"/>`,
      `<g transform="rotate(-8 6 70)"><rect x="-26" y="52" width="64" height="40" rx="2" fill="#f6f0e2" stroke="#c9bca2" stroke-width="1.5"/>`,
      `<polyline points="${pts([[-26, 52], [6, 76], [38, 52]])}" stroke="#c9bca2" stroke-width="1.5" fill="none"/>`,
      `<circle cx="6" cy="76" r="6" fill="#b8433a"/></g>`,
    );
  }
  if (glints > 0) {
    const r = rng(7);
    for (let i = 0; i < 9; i++) {
      const gx = -120 + r() * 260;
      const gy = -170 + r() * 190;
      const a = Math.max(0, Math.sin(t * 3 + i * 1.9)) * glints;
      shapes.push(`<path d="M ${f(gx)} ${f(gy - 9)} L ${f(gx + 2)} ${f(gy - 2)} L ${f(gx + 9)} ${f(gy)} L ${f(gx + 2)} ${f(gy + 2)} L ${f(gx)} ${f(gy + 9)} L ${f(gx - 2)} ${f(gy + 2)} L ${f(gx - 9)} ${f(gy)} L ${f(gx - 2)} ${f(gy - 2)} Z" fill="#fff6dd" opacity="${f(a)}"/>`);
    }
  }
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(scale * facing)} ${f(scale)})">${shapes.join("")}</g>`;
}

function demoMark() {
  return `<g font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700">
  <rect x="${SIZE - 330}" y="${SIZE - 56}" width="312" height="38" rx="6" fill="#000" fill-opacity="0.5"/>
  <text x="${SIZE - 174}" y="${SIZE - 30}" text-anchor="middle" textLength="280" lengthAdjust="spacingAndGlyphs" fill="#fff" fill-opacity="0.95">DEMO SAMPLE · ORIGINAL ART</text></g>`;
}

function frame(p, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${defs(p)}${body}${demoMark()}</svg>`;
}

/** Key art: Tsumugi over the harbour town at dusk (the example's text-to-image result). */
export function keyArt() {
  const p = PALETTES.dusk;
  return frame(
    p,
    sky() +
      town(p, 11, 760, 300, p.far) +
      lanterns(p, 0.4, 600, 7, 3) +
      town(p, 12, 900, 240, p.near) +
      `<rect y="900" width="${SIZE}" height="124" fill="url(#water)"/>` +
      crane({ x: 520, y: 380, scale: 1.25, flap: 0.6 }) +
      rain(0, 21),
  );
}

/** A lantern-lit harbour street, for other prompts. */
export function harbourStreet() {
  const p = PALETTES.night;
  return frame(p, sky() + town(p, 31, 700, 380, p.far) + lanterns(p, 1.2, 420, 9, 5, 40) + lanterns(p, 2.1, 560, 6, 6, 30) + town(p, 32, 1024, 260, p.near) + rain(0, 33, 170));
}

/** A close look at braided cords, for other prompts. */
export function cords() {
  const p = PALETTES.dusk;
  const strands = [];
  for (let i = 0; i < 7; i++) {
    const y = 160 + i * 110;
    strands.push(braid(-40, y, SIZE + 40, y + 60, 26, 26));
  }
  return frame(p, `<rect width="${SIZE}" height="${SIZE}" fill="#efe6d4"/>` + `<g transform="rotate(-12 512 512)">${strands.join("")}</g>`);
}

/** Shot 1, wide: Tsumugi lifts off a wet tiled rooftop while lanterns flicker below. */
export function shotWide(t, take = "a") {
  const p = take === "a" ? PALETTES.dusk : PALETTES.night;
  const u = Math.min(1, t / 5);
  const ease = u * u * (3 - 2 * u);
  const push = 1 + 0.06 * u;
  const dir = take === "a" ? 1 : -1;
  const cx = 512 + dir * (-150 + 330 * ease);
  const cy = 700 - 430 * ease;
  const tiles = [];
  for (let row = 0; row < 6; row++) {
    for (let x = -40 + (row % 2) * 35; x < SIZE + 40; x += 70) {
      const y = 800 + row * 40;
      tiles.push(`<path d="M ${x} ${y} q 35 -22 70 0" stroke="#3b4660" stroke-width="7" fill="none"/>`);
    }
  }
  return frame(
    p,
    `<g transform="translate(512 512) scale(${f(push)}) translate(-512 -512)">` +
      sky() +
      town(p, 41, 640, 300, p.far) +
      lanterns(p, t, 520, take === "a" ? 7 : 10, 9) +
      town(p, 42, 790, 200, p.near) +
      `<rect y="780" width="${SIZE}" height="260" fill="#232c42"/>` +
      tiles.join("") +
      crane({ x: cx, y: cy, scale: 0.9 - 0.35 * ease, flap: Math.sin(t * 9), facing: dir }) +
      rain(t, 43) +
      `</g>`,
  );
}

/** Shot 2, close-up: Tsumugi tucks a letter under one wing as raindrops bead on the folded paper. */
export function shotClose(t, take = "a") {
  const p = PALETTES.dusk;
  const bokeh = [];
  const r = rng(take === "a" ? 51 : 52);
  for (let i = 0; i < 16; i++) {
    bokeh.push(`<circle cx="${f(r() * SIZE)}" cy="${f(r() * SIZE * 0.8)}" r="${f(40 + r() * 70)}" fill="url(#bokeh)" opacity="${f(0.4 + 0.3 * Math.sin(t * 1.5 + i))}"/>`);
  }
  const drops = [];
  const dr = rng(53);
  for (let i = 0; i < 22; i++) {
    const born = dr() * 4;
    const age = t - born;
    if (age < 0) continue;
    const dx = 300 + dr() * 520;
    const dy = 280 + dr() * 330 + Math.max(0, age - 1.2) * 60;
    const rad = Math.min(9, 2 + age * 6);
    drops.push(`<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(rad)}" fill="#e8f1ff" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.8" stroke-width="1.2"/>`);
  }
  const breathe = 1 + 0.015 * Math.sin(t * 2);
  return frame(
    p,
    sky() +
      bokeh.join("") +
      crane({ x: 560, y: 600, scale: 2.5 * breathe, flap: 0.15 + 0.05 * Math.sin(t * 2), glints: take === "b" ? 1 : 0, t }) +
      drops.join("") +
      rain(t, 54, 70, 700, 0.25),
  );
}

/** Shot 3, tracking: Tsumugi glides low between moored fishing boats toward a lit window. */
export function shotTracking(t, take = "a") {
  const p = take === "a" ? PALETTES.dusk : PALETTES.night;
  const boats = (seed, y, size, speed, color) => {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const base = i * 300 + r() * 120;
      const x = ((base - t * speed) % 1800 + 1800) % 1800 - 300;
      const w = 160 * size;
      out.push(`<polygon points="${pts([[x, y], [x + w, y], [x + w * 0.85, y + 34 * size], [x + w * 0.12, y + 34 * size]])}" fill="${color}"/>`);
      out.push(`<line x1="${f(x + w * 0.45)}" y1="${f(y)}" x2="${f(x + w * 0.45)}" y2="${f(y - 120 * size)}" stroke="${color}" stroke-width="${f(4 * size)}"/>`);
      if (take === "b") out.push(`<circle cx="${f(x + w * 0.45)}" cy="${f(y - 120 * size)}" r="${f(8 * size)}" fill="${p.lantern}"/>`);
    }
    return out.join("");
  };
  const windowGlow = 1 + 0.25 * (t / 5);
  return frame(
    p,
    sky() +
      town(p, 61, 600, 260, p.far, t * 10) +
      `<circle cx="780" cy="470" r="${f(60 * windowGlow)}" fill="url(#glow)"/><rect x="765" y="452" width="30" height="40" fill="${p.window}"/>` +
      `<rect y="600" width="${SIZE}" height="424" fill="url(#water)"/>` +
      boats(71, 640, 0.6, 60, "#17243a") +
      crane({ x: 380, y: 610 + 14 * Math.sin(t * 2.2), scale: 0.75, flap: 0.35 + 0.25 * Math.sin(t * 4), facing: 1 }) +
      boats(72, 800, 1.1, 160, "#0d1625") +
      rain(t, 73),
  );
}

export const SHOTS = { wide: shotWide, close: shotClose, tracking: shotTracking };
