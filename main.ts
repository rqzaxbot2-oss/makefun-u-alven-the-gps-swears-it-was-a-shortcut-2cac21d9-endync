import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type RGB = readonly [number, number, number];

interface CandidateSpec {
  readonly id: string;
  readonly line: string;
  readonly selected: boolean;
  readonly note: string;
}

interface CandidateEntry extends CandidateSpec {
  readonly chars: number;
}

const BOUNTY_ID = "u-alven-the-gps-swears-it-was-a-shortcut-2cac21d9";
const MAX_EXCUSE_CHARS = 200;
const EXCUSE =
  "Recalculating. In 200 feet, exit the cornfield; you checked avoid tolls, not avoid agriculture, and frankly a sedan with your monthly payment should handle light farming.";

const CANDIDATE_SPECS: readonly CandidateSpec[] = [
  {
    id: "gps-01",
    line: EXCUSE,
    selected: true,
    note: "Instant GPS cadence, pedantic checkbox defense, deadpan financial roast.",
  },
  {
    id: "gps-02",
    line: "In 100 feet, make a legal U-turn inside this barn; in my defense, the 2014 satellite photo looked paved and the cows looked like compact sedans.",
    selected: false,
    note: "Strong satellite-imagery excuse; slightly less personal punchline.",
  },
  {
    id: "gps-03",
    line: "Recalculating. Technically this boat ramp shaves four minutes off your ETA, and it is not my fault your sedan lacks both ambition and buoyancy.",
    selected: false,
    note: "Sharp nautical dry humor; closer to familiar lake-driving trope.",
  },
];

const FONT: Readonly<Record<string, string>> = {
  A: "ehvhh", B: "uhuhu", C: "fgggf", D: "uhhhu", E: "vgugv", F: "vgugg",
  G: "fgnhf", H: "hhvhh", I: "e444e", J: "722ic", K: "hisih", L: "ggggv",
  M: "hrlhh", N: "hpljh", O: "ehhhe", P: "uhugg", Q: "ehlid", R: "uhuih",
  S: "fge1u", T: "v4444", U: "hhhhe", V: "hhha4", W: "hhlrh", X: "ha4ah",
  Y: "ha444", Z: "v248v", 0: "ejlpe", 1: "4c44e", 2: "eh68v", 3: "u1e1u",
  4: "iiv22", 5: "vgu1u", 6: "fguhe", 7: "v2488", 8: "ehehe", 9: "ehf1u",
  ".": "00004", ",": "00048", ";": "04048", "-": "00e00", ":": "04040",
  "/": "1248g", "'": "44000", "!": "44404", "?": "e1604", " ": "00000",
};

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}

function validateExcuseLine(line: string, label: string): void {
  if (line.length === 0 || line.length > MAX_EXCUSE_CHARS) {
    throw new Error(`${label}: length ${line.length} must be between 1 and ${MAX_EXCUSE_CHARS}`);
  }
  if (line !== line.trim()) {
    throw new Error(`${label}: must not have leading or trailing whitespace`);
  }
  if (/[\x00-\x1f\x7f\u2028\u2029]/.test(line)) {
    throw new Error(`${label}: must be a single line of plain text without control characters`);
  }
}

function buildValidatedCandidates(specs: readonly CandidateSpec[]): CandidateEntry[] {
  validateExcuseLine(EXCUSE, "EXCUSE");
  let selectedCount = 0;
  const entries: CandidateEntry[] = specs.map((spec) => {
    validateExcuseLine(spec.line, spec.id);
    if (spec.selected) {
      selectedCount += 1;
      if (spec.line !== EXCUSE) {
        throw new Error(`Selected candidate ${spec.id} does not match EXCUSE`);
      }
    }
    return { ...spec, chars: spec.line.length };
  });
  if (selectedCount !== 1) {
    throw new Error(`Expected exactly 1 selected candidate, found ${selectedCount}`);
  }
  return entries;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new Error(`Invalid PNG chunk type: ${type}`);
  }
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number, bg: RGB) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      throw new Error(`Invalid canvas dimensions: ${w}x${h}`);
    }
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }

  setPx(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return;
    const o = (iy * this.w + ix) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }

  fillRect(x: number, y: number, rw: number, rh: number, c: RGB): void {
    if (rw <= 0 || rh <= 0) return;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + rw));
    const y1 = Math.min(this.h, Math.ceil(y + rh));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.w + xx) * 3;
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
      }
    }
  }

  strokeRect(x: number, y: number, rw: number, rh: number, t: number, c: RGB): void {
    if (t <= 0 || rw <= 0 || rh <= 0) return;
    const bt = Math.min(t, rw / 2, rh / 2);
    this.fillRect(x, y, rw, bt, c);
    this.fillRect(x, y + rh - bt, rw, bt, c);
    this.fillRect(x, y, bt, rh, c);
    this.fillRect(x + rw - bt, y, bt, rh, c);
  }

  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    if (r < 0) return;
    const r2 = r * r;
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        if (dx * dx + dy * dy <= r2) this.setPx(cx + dx, cy + dy, c);
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
    if (t <= 0) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const half = t / 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      this.fillRect(x - half, y - half, t, t, c);
    }
  }

  drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
    if (scale <= 0 || text.length === 0) return;
    const up = text.toUpperCase();
    let cx = x;
    for (let i = 0; i < up.length; i++) {
      const glyph = FONT[up[i]] ?? FONT[" "];
      for (let r = 0; r < 5; r++) {
        const bits = parseInt(glyph[r], 32);
        for (let col = 0; col < 5; col++) {
          if ((bits >> (4 - col)) & 1) {
            this.fillRect(cx + col * scale, y + r * scale, scale, scale, c);
          }
        }
      }
      cx += 6 * scale;
    }
  }

  toPng(): Buffer {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const stride = this.w * 3;
    const raw = Buffer.alloc((stride + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      const ro = y * (stride + 1);
      raw[ro] = 0;
      raw.set(this.px.subarray(y * stride, (y + 1) * stride), ro + 1);
    }
    const idat = deflateSync(raw, { level: 9 });
    return Buffer.concat([
      sig,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", idat),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function wrapText(text: string, maxCols: number): string[] {
  if (!Number.isInteger(maxCols) || maxCols <= 0) {
    throw new Error(`maxCols must be a positive integer, got ${maxCols}`);
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (word.length > maxCols) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < word.length; i += maxCols) {
        const chunk = word.slice(i, i + maxCols);
        if (chunk.length === maxCols) {
          lines.push(chunk);
        } else {
          cur = chunk;
        }
      }
      continue;
    }
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= maxCols) {
      cur += " " + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function renderNavScreenshot(): Buffer {
  const cv = new Canvas(640, 360, [11, 17, 24]);
  cv.fillRect(16, 62, 608, 190, [19, 34, 26]);
  for (let row = 72; row < 248; row += 12) {
    cv.fillRect(220, row, 396, 3, [29, 54, 34]);
  }
  cv.drawLine(72, 250, 148, 62, 26, [44, 52, 64]);
  cv.drawLine(72, 250, 148, 62, 2, [214, 176, 72]);
  cv.drawLine(112, 176, 340, 152, 8, [52, 211, 153]);
  cv.drawLine(340, 152, 488, 118, 8, [250, 204, 21]);
  cv.fillCircle(488, 118, 11, [239, 68, 68]);
  cv.fillCircle(488, 118, 5, [254, 242, 242]);
  cv.fillCircle(340, 152, 8, [56, 189, 248]);
  cv.strokeRect(16, 62, 608, 190, 2, [45, 68, 84]);
  cv.fillRect(16, 14, 608, 40, [15, 118, 110]);
  cv.drawText("RECALCULATING - 200 FT - EXIT CORNFIELD", 30, 29, 2, [240, 253, 250]);
  cv.fillRect(422, 74, 190, 24, [15, 23, 42]);
  cv.drawText("AVOID TOLLS: ON", 432, 81, 2, [74, 222, 128]);
  cv.fillRect(422, 102, 190, 24, [15, 23, 42]);
  cv.drawText("AVOID CROPS: OFF", 432, 109, 2, [248, 113, 113]);
  cv.fillRect(16, 260, 608, 86, [15, 23, 42]);
  cv.strokeRect(16, 260, 608, 86, 2, [56, 189, 248]);
  const lines = wrapText(EXCUSE, 48).slice(0, 4);
  lines.forEach((line, idx) => {
    cv.drawText(line, 28, 272 + idx * 18, 2, [226, 232, 240]);
  });
  return cv.toPng();
}

function renderCardScreenshot(): Buffer {
  const cv = new Canvas(640, 360, [15, 23, 42]);
  cv.strokeRect(18, 18, 604, 324, 3, [15, 118, 110]);
  cv.fillRect(36, 36, 568, 38, [17, 94, 89]);
  cv.drawText(
    `GPS VOICE EXCUSE // ${EXCUSE.length} OF ${MAX_EXCUSE_CHARS} CHARS`,
    52,
    50,
    2,
    [204, 251, 241],
  );
  const lines = wrapText(EXCUSE, 44).slice(0, 5);
  lines.forEach((line, idx) => {
    cv.drawText(line, 44, 118 + idx * 28, 2, [248, 250, 252]);
  });
  cv.fillRect(36, 282, 568, 36, [30, 41, 59]);
  cv.drawText("ROUTE: CORNFIELD SHORTCUT  ETA: -4 MIN", 52, 295, 2, [250, 204, 21]);
  return cv.toPng();
}

function escapeInlineJson(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildDashboardHtml(payloadJson: string): string {
  const safeJson = escapeInlineJson(payloadJson);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The GPS Swears It Was a Shortcut</title>
<style>
  :root{--bg:#0b1118;--panel:#131d29;--line:#233447;--teal:#14b8a6;--amber:#facc15;--text:#e2e8f0;--muted:#94a3b8;--red:#f87171}
  *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top,#132a2e,var(--bg) 60%);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,sans-serif;padding:24px}
  .wrap{max-width:920px;margin:0 auto;display:grid;gap:18px}
  .banner{background:linear-gradient(90deg,#0f766e,#115e59);border-radius:14px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border:1px solid #2dd4bf55}
  .banner h1{margin:0;font-size:19px;letter-spacing:.02em} .pill{background:#042f2e;color:#99f6e4;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px}
  .excuse{font-size:22px;line-height:1.45;font-weight:600;color:#f8fafc;border-left:4px solid var(--teal);padding-left:16px;margin:8px 0 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .stat{background:#0f172a;border:1px solid var(--line);border-radius:10px;padding:12px}
  .stat .k{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em} .stat .v{font-size:18px;font-weight:700;margin-top:4px}
  .ok{color:#4ade80} .warn{color:var(--amber)} .bad{color:var(--red)}
  svg{width:100%;height:auto;border-radius:10px;background:#13221a;border:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)} th{color:var(--muted);font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <div class="banner">
    <h1>NAV-9000 // RECALCULATING</h1>
    <span class="pill" id="char-pill">${EXCUSE.length} / ${MAX_EXCUSE_CHARS} CHARS</span>
  </div>
  <div class="card">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--teal)">Official GPS Voice Excuse</div>
    <p class="excuse" id="excuse-text"></p>
  </div>
  <div class="grid" id="stats"></div>
  <div class="card">
    <svg viewBox="0 0 640 210" role="img" aria-label="Route deviation diagram">
      <g stroke="#214029" stroke-width="2">
        <line x1="210" y1="24" x2="620" y2="24"/><line x1="210" y1="48" x2="620" y2="48"/><line x1="210" y1="72" x2="620" y2="72"/>
        <line x1="210" y1="96" x2="620" y2="96"/><line x1="210" y1="120" x2="620" y2="120"/><line x1="210" y1="144" x2="620" y2="144"/>
        <line x1="210" y1="168" x2="620" y2="168"/><line x1="210" y1="192" x2="620" y2="192"/>
      </g>
      <path d="M 70 210 L 155 0" stroke="#334155" stroke-width="30" fill="none"/>
      <path d="M 70 210 L 155 0" stroke="#eab308" stroke-width="2" stroke-dasharray="10 8" fill="none"/>
      <path d="M 105 130 L 340 112 L 505 78" stroke="#14b8a6" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="340" cy="112" r="8" fill="#38bdf8"/><circle cx="505" cy="78" r="10" fill="#ef4444"/><circle cx="505" cy="78" r="4" fill="#fff"/>
      <text x="225" y="185" fill="#86efac" font-size="13" font-family="monospace">ACTIVE CORNFIELD CORRIDOR (TOLL-FREE)</text>
    </svg>
  </div>
  <div class="card">
    <h2 style="margin:0 0 10px;font-size:15px">Candidate Selection Audit</h2>
    <table><thead><tr><th>ID</th><th>Chars</th><th>Status</th><th>Line</th></tr></thead><tbody id="cand-body"></tbody></table>
  </div>
</div>
<script src="./data.js"></script>
<script>
const data = window.GPS_SHORTCUT_DATA || ${safeJson};
document.getElementById("excuse-text").textContent = data.excuse;
document.getElementById("char-pill").textContent = data.charCount + " / " + data.maxChars + " CHARS";
const stats = [
  ["Avoid Tolls", "CHECKED", "ok"],
  ["Avoid Agriculture", "UNCHECKED", "bad"],
  ["Toll Savings", "$4.50", "ok"],
  ["Vehicle Ambition", "UNDERPERFORMING", "warn"],
];
const statsEl = document.getElementById("stats");
for (const [k, v, cls] of stats) {
  const card = document.createElement("div");
  card.className = "stat";
  const kEl = document.createElement("div");
  kEl.className = "k";
  kEl.textContent = k;
  const vEl = document.createElement("div");
  vEl.className = "v " + cls;
  vEl.textContent = v;
  card.append(kEl, vEl);
  statsEl.appendChild(card);
}
const tbody = document.getElementById("cand-body");
for (const c of data.candidates) {
  const tr = document.createElement("tr");
  const cells = [c.id, String(c.chars), c.selected ? "SELECTED" : "ALT", c.line];
  cells.forEach((value, idx) => {
    const td = document.createElement("td");
    if (idx === 2 && c.selected) td.className = "ok";
    td.textContent = value;
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
}
</script>
</body>
</html>
`;
}

function main(): void {
  const candidates = buildValidatedCandidates(CANDIDATE_SPECS);
  const outDir = (process.env.MAKEFUN_OUTPUT_DIR ?? "").trim() || "./out";
  const shotsDir = join(outDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });

  const excuseHash = createHash("sha256").update(EXCUSE + "\n", "utf8").digest("hex");

  const board = {
    bounty: BOUNTY_ID,
    title: "Avoid Tolls, Not Agriculture",
    excuse: EXCUSE,
    charCount: EXCUSE.length,
    maxChars: MAX_EXCUSE_CHARS,
    singleLine: true,
    plainText: true,
    sha256: excuseHash,
    candidates,
  };

  const dossier = {
    entry: {
      excuse: EXCUSE,
      charCount: EXCUSE.length,
      maxChars: MAX_EXCUSE_CHARS,
      hasNewline: false,
      hasDialogueTags: false,
      sha256: excuseHash,
    },
    incident: {
      unitModel: "NAV-9000",
      plannedRoute: "I-95 Express Tollway",
      actualRoute: "County Cornfield Row 14",
      routePreferences: {
        avoidTolls: true,
        avoidHighways: false,
        avoidAgriculture: false,
      },
      estimatedTimeSavedMinutes: 4,
      tollSavedUsd: 4.5,
      cornstalksNegotiated: 47,
    },
    artifacts: [
      "excuse.txt",
      "board.json",
      "dossier.json",
      "data.js",
      "index.html",
      "screenshot.png",
      "screenshots/excuse-card.png",
    ],
  };

  const boardJson = JSON.stringify(board, null, 2) + "\n";
  const dossierJson = JSON.stringify(dossier, null, 2) + "\n";
  const dataJs = `window.GPS_SHORTCUT_DATA = ${JSON.stringify(board, null, 2)};\n`;
  const dashboardHtml = buildDashboardHtml(JSON.stringify(board));
  const navPng = renderNavScreenshot();
  const cardPng = renderCardScreenshot();

  writeFileSync(join(outDir, "excuse.txt"), EXCUSE + "\n", "utf8");
  writeFileSync(join(outDir, "board.json"), boardJson, "utf8");
  writeFileSync(join(outDir, "dossier.json"), dossierJson, "utf8");
  writeFileSync(join(outDir, "data.js"), dataJs, "utf8");
  writeFileSync(join(outDir, "index.html"), dashboardHtml, "utf8");
  writeFileSync(join(outDir, "screenshot.png"), navPng);
  writeFileSync(join(shotsDir, "excuse-card.png"), cardPng);

  process.stdout.write(EXCUSE + "\n");
}

main();