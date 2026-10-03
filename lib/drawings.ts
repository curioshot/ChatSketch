// shared types, board units are integers with origin top-left
export const BOARD_SIZE = 1000;

export type BoardSize = { w: number; h: number };

// paper presets, a-series keeps the 1 to root-2 ratio
export const SIZE_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: "square", label: "Square", w: 1000, h: 1000 },
  { id: "wide", label: "Wide 16:9", w: 1280, h: 720 },
  { id: "a4p", label: "A4 portrait", w: 707, h: 1000 },
  { id: "a4l", label: "A4 landscape", w: 1000, h: 707 },
  { id: "a3p", label: "A3 portrait", w: 1000, h: 1414 },
  { id: "a3l", label: "A3 landscape", w: 1414, h: 1000 },
  { id: "a2p", label: "A2 portrait", w: 1414, h: 2000 },
  { id: "a2l", label: "A2 landscape", w: 2000, h: 1414 },
];

// clamping custom sizes so boards stay sane
export function cleanSize(w: unknown, h: unknown): BoardSize {
  const cw = Math.round(Number(w));
  const ch = Math.round(Number(h));
  return {
    w: Number.isFinite(cw) ? Math.min(4000, Math.max(100, cw)) : 1000,
    h: Number.isFinite(ch) ? Math.min(4000, Math.max(100, ch)) : 1000,
  };
}

// matching a size to its preset name, else custom
export function sizeLabel(size: BoardSize): string {
  const hit = SIZE_PRESETS.find((p) => p.w === size.w && p.h === size.h);
  const name = hit ? hit.label : "Custom";
  return `${name} · ${size.w} × ${size.h}`;
}

export type Tool = "brush" | "eraser" | "line" | "rect" | "circle" | "text" | "hand" | "ellipse" | "triangle" | "star" | "arrow" | "dropper" | "select";
export type Mode = "brush-ops" | "svg";

// translucency for strokes and text, 0.05-1, omit for solid
export type Opacity = { opacity?: number };

export type DrawOp =
  | ({ op: "line"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; to: [number, number] } & Opacity)
  | ({ op: "polyline"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; points: [number, number][] } & Opacity)
  | ({ op: "bezier"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; cp1: [number, number]; cp2: [number, number]; to: [number, number] } & Opacity)
  | ({ op: "circle"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; r: number } & Opacity)
  | ({ op: "rect"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; w: number; h: number } & Opacity)
  | ({ op: "text"; key?: string; tool: Tool; color: string; center: [number, number]; size: number; content: string } & Opacity)
  | ({ op: "svg"; key?: string; tool: Tool; markup: string } & Opacity)
  | ({ op: "ellipse"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; rx: number; ry: number } & Opacity)
  | ({ op: "triangle"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; w: number; h: number } & Opacity)
  | ({ op: "star"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; r: number } & Opacity)
  | ({ op: "arrow"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; to: [number, number] } & Opacity);

// paper grid, shown over the sheet when show is true, snap pulls input to it
export type Grid = { size: number; show: boolean; snap: boolean };

// sane grid from anywhere, overlay stays subtle
export function cleanGrid(g: unknown): Grid {
  const m = (g || {}) as Record<string, unknown>;
  const size = Math.round(Number(m.size));
  return {
    size: Number.isFinite(size) ? Math.min(500, Math.max(10, size)) : 100,
    show: m.show === true,
    snap: m.snap === true,
  };
}

// one named group of strokes, painted in array order
export type Layer = { id: string; name: string; visible: boolean; keys: string[] };

export type ChatMsg = { me: boolean; text: string; questions?: PlanQuestion[]; done?: boolean; via?: string; kind?: "plan" | "build" };
export type Intent = "plan" | "build" | "refine";

// one clarifying question from plan mode
export type PlanQuestion = {
  id: string;
  text: string;
  multi: boolean;
  allowText: boolean;
  options: string[];
};

export type Drawing = {
  id: string;
  title: string;
  mode: Mode;
  size: BoardSize;
  ops: DrawOp[];
  layers: Layer[];
  grid: Grid;
  bg?: { src: string; w: number; h: number };
  chat: ChatMsg[];
  intent: Intent;
  updatedAt: number;
};

const KEY = "ai-board-drawings-v1";

// fresh layer for new drawings
export function blankLayer(name: string): Layer {
  return { id: crypto.randomUUID(), name, visible: true, keys: [] };
}

// old saves lack newer fields, filling defaults so nothing breaks
function normalize(d: Drawing): Drawing {
  const ops = Array.isArray(d.ops) ? d.ops : [];
  for (const o of ops) {
    if (!o.key) o.key = crypto.randomUUID();
  }
  let layers = Array.isArray(d.layers) && d.layers.length ? d.layers : [blankLayer("Layer 1")];
  // first layer adopts orphan strokes
  const known = new Set(layers.flatMap((l) => l.keys));
  const orphans = ops.map((o) => o.key as string).filter((k) => k && !known.has(k));
  if (orphans.length) layers = [{ ...layers[0], keys: [...layers[0].keys, ...orphans] }, ...layers.slice(1)];
  const size = d.size && Number.isFinite(d.size.w) && Number.isFinite(d.size.h)
    ? cleanSize(d.size.w, d.size.h)
    : { w: BOARD_SIZE, h: BOARD_SIZE };
  return {
    ...d,
    ops,
    layers,
    size,
    grid: cleanGrid((d as Record<string, unknown>).grid),
    chat: Array.isArray(d.chat) ? d.chat : [],
    intent: d.intent === "plan" ? "plan" : "build",
  };
}

// brush styles, one stroke may need several passes (neon glow)
export type BrushPass = { wMul: number; alpha: number };
export function brushPasses(o: DrawOp): BrushPass[] {
  if (o.tool === "eraser") return [{ wMul: 1, alpha: 1 }];
  const b =
    o.op === "line" || o.op === "polyline" || o.op === "bezier" || o.op === "circle" || o.op === "rect" ||
    o.op === "ellipse" || o.op === "triangle" || o.op === "star" || o.op === "arrow"
      ? o.brush
      : undefined;
  if (b === "neon") return [{ wMul: 3, alpha: 0.3 }, { wMul: 1.2, alpha: 1 }];
  if (b === "marker") return [{ wMul: 1.8, alpha: 0.55 }];
  if (b === "pencil") return [{ wMul: 0.6, alpha: 0.9 }];
  return [{ wMul: 1, alpha: 1 }];
}

// shared geometry so canvas, svg and export draw identical shapes
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// isoceles triangle from center box: apex top, base bottom
export function triPoints(cx: number, cy: number, w: number, h: number): [number, number][] {
  return [
    [round1(cx), round1(cy - h / 2)],
    [round1(cx + w / 2), round1(cy + h / 2)],
    [round1(cx - w / 2), round1(cy + h / 2)],
  ];
}

// five-point star polygon from center and radius
export function starPoints(cx: number, cy: number, r: number, spikes = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push([round1(cx + rr * Math.cos(a)), round1(cy + rr * Math.sin(a))]);
  }
  return pts;
}

// arrowhead wings from shaft direction and stroke width
export function arrowHead(from: [number, number], to: [number, number], w: number): [[number, number], [number, number]] {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = Math.max(14, w * 3);
  const a1 = ang + (Math.PI * 5) / 6;
  const a2 = ang - (Math.PI * 5) / 6;
  return [
    [round1(to[0] + len * Math.cos(a1)), round1(to[1] + len * Math.sin(a1))],
    [round1(to[0] + len * Math.cos(a2)), round1(to[1] + len * Math.sin(a2))],
  ];
}

// rough text width so boxes and hit tests match what the canvas draws
export function textSize(content: string, size: number): [number, number] {
  return [Math.max(8, Math.round(content.length * size * 0.55)), size];
}

// distance from a point to a segment, for hit-testing strokes
export function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// inside test for polygon shapes
export function pointInPoly(p: [number, number], pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// polygon outline of an op, for filled hit tests and edge distance
function opPoly(o: DrawOp): [number, number][] | null {
  if (o.op === "rect") {
    const x = o.center[0] - o.w / 2;
    const y = o.center[1] - o.h / 2;
    return [[x, y], [x + o.w, y], [x + o.w, y + o.h], [x, y + o.h]];
  }
  if (o.op === "triangle") return triPoints(o.center[0], o.center[1], o.w, o.h);
  if (o.op === "star") return starPoints(o.center[0], o.center[1], o.r);
  return null;
}

// bounding box of one op, null when not measurable (injected svg)
export function opBBox(o: DrawOp): [number, number, number, number] | null {
  if (o.op === "svg") return null;
  const pad = o.op === "text" ? 0 : o.strokeWidth / 2;
  const box = (xs: number[], ys: number[]): [number, number, number, number] => [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
  if (o.op === "line" || o.op === "arrow") return box([o.from[0], o.to[0]], [o.from[1], o.to[1]]);
  if (o.op === "polyline") return box(o.points.map((p) => p[0]), o.points.map((p) => p[1]));
  if (o.op === "bezier") return box([o.from[0], o.cp1[0], o.cp2[0], o.to[0]], [o.from[1], o.cp1[1], o.cp2[1], o.to[1]]);
  if (o.op === "circle") return box([o.center[0] - o.r, o.center[0] + o.r], [o.center[1] - o.r, o.center[1] + o.r]);
  if (o.op === "ellipse") return box([o.center[0] - o.rx, o.center[0] + o.rx], [o.center[1] - o.ry, o.center[1] + o.ry]);
  if (o.op === "rect" || o.op === "triangle") return box([o.center[0] - o.w / 2, o.center[0] + o.w / 2], [o.center[1] - o.h / 2, o.center[1] + o.h / 2]);
  if (o.op === "star") return box([o.center[0] - o.r, o.center[0] + o.r], [o.center[1] - o.r, o.center[1] + o.r]);
  if (o.op === "text") {
    const [w, h] = textSize(o.content, o.size);
    return [o.center[0] - w / 2, o.center[1] - h / 2, o.center[0] + w / 2, o.center[1] + h / 2];
  }
  return null;
}

// is the board point on the stroke, tol in board units
export function hitOp(o: DrawOp, p: [number, number], tol: number): boolean {
  if (o.op === "svg") return false;
  const t = tol + (o.op === "text" ? 0 : o.strokeWidth / 2);
  if (o.op === "line" || o.op === "arrow") {
    if (segDist(p, o.from, o.to) <= t) return true;
    if (o.op === "arrow") {
      const [h1, h2] = arrowHead(o.from, o.to, o.strokeWidth);
      return segDist(p, h1, o.to) <= t || segDist(p, h2, o.to) <= t;
    }
    return false;
  }
  if (o.op === "polyline") {
    for (let i = 1; i < o.points.length; i++) if (segDist(p, o.points[i - 1], o.points[i]) <= t) return true;
    return false;
  }
  if (o.op === "bezier") {
    let prev: [number, number] = o.from;
    for (let i = 1; i <= 20; i++) {
      const u = i / 20;
      const v = 1 - u;
      const cur: [number, number] = [
        v * v * v * o.from[0] + 3 * v * v * u * o.cp1[0] + 3 * v * u * u * o.cp2[0] + u * u * u * o.to[0],
        v * v * v * o.from[1] + 3 * v * v * u * o.cp1[1] + 3 * v * u * u * o.cp2[1] + u * u * u * o.to[1],
      ];
      if (segDist(p, prev, cur) <= t) return true;
      prev = cur;
    }
    return false;
  }
  if (o.op === "circle") {
    const d = Math.hypot(p[0] - o.center[0], p[1] - o.center[1]);
    return o.fill ? d <= o.r + t : Math.abs(d - o.r) <= t;
  }
  if (o.op === "ellipse") {
    const v = ((p[0] - o.center[0]) / Math.max(1, o.rx)) ** 2 + ((p[1] - o.center[1]) / Math.max(1, o.ry)) ** 2;
    if (o.fill) return v <= 1 + t / Math.max(1, Math.min(o.rx, o.ry));
    return Math.abs(Math.sqrt(Math.max(0, v)) - 1) * Math.min(o.rx, o.ry) <= t;
  }
  if (o.op === "rect" || o.op === "triangle" || o.op === "star") {
    const poly = opPoly(o);
    if (!poly) return false;
    if (o.fill && pointInPoly(p, poly)) return true;
    for (let i = 0; i < poly.length; i++) if (segDist(p, poly[i], poly[(i + 1) % poly.length]) <= t) return true;
    return false;
  }
  const [w, h] = textSize(o.content, o.size);
  return Math.abs(p[0] - o.center[0]) <= w / 2 + t && Math.abs(p[1] - o.center[1]) <= h / 2 + t;
}

// shifting every point of an op, clamped to the paper, key kept
export function moveOp(o: DrawOp, dx: number, dy: number, bw: number, bh: number): DrawOp {
  if (o.op === "svg") return o;
  const mv = (p: [number, number]): [number, number] => [
    Math.min(bw, Math.max(0, Math.round(p[0] + dx))),
    Math.min(bh, Math.max(0, Math.round(p[1] + dy))),
  ];
  if (o.op === "line" || o.op === "arrow") return { ...o, from: mv(o.from), to: mv(o.to) };
  if (o.op === "polyline") return { ...o, points: o.points.map(mv) };
  if (o.op === "bezier") return { ...o, from: mv(o.from), cp1: mv(o.cp1), cp2: mv(o.cp2), to: mv(o.to) };
  if (o.op === "circle" || o.op === "ellipse" || o.op === "rect" || o.op === "triangle" || o.op === "star" || o.op === "text") {
    return { ...o, center: mv(o.center) };
  }
  return o;
}

// scaling an op about a center, for resize handles, key kept
export function scaleOp(o: DrawOp, cx: number, cy: number, sx: number, sy: number, bw: number, bh: number): DrawOp {
  if (o.op === "svg") return o;
  const sc = (p: [number, number]): [number, number] => [
    Math.min(bw, Math.max(0, Math.round(cx + (p[0] - cx) * sx))),
    Math.min(bh, Math.max(0, Math.round(cy + (p[1] - cy) * sy))),
  ];
  const ax = Math.abs(sx) || 0.01;
  const ay = Math.abs(sy) || 0.01;
  const am = Math.max(ax, ay);
  if (o.op === "line" || o.op === "arrow") return { ...o, from: sc(o.from), to: sc(o.to) };
  if (o.op === "polyline") return { ...o, points: o.points.map(sc) };
  if (o.op === "bezier") return { ...o, from: sc(o.from), cp1: sc(o.cp1), cp2: sc(o.cp2), to: sc(o.to) };
  if (o.op === "circle") return { ...o, center: sc(o.center), r: Math.max(1, Math.round(o.r * am)) };
  if (o.op === "ellipse") return { ...o, center: sc(o.center), rx: Math.max(1, Math.round(o.rx * ax)), ry: Math.max(1, Math.round(o.ry * ay)) };
  if (o.op === "rect" || o.op === "triangle") {
    return { ...o, center: sc(o.center), w: Math.max(1, Math.round(o.w * ax)), h: Math.max(1, Math.round(o.h * ay)) };
  }
  if (o.op === "star") return { ...o, center: sc(o.center), r: Math.max(1, Math.round(o.r * am)) };
  return { ...o, center: sc(o.center), size: Math.min(200, Math.max(8, Math.round(o.size * am))) };
}

// paint order: layers top to bottom, then orphan strokes in array order
export function orderedVisibleOps(ops: DrawOp[], layers: Layer[]): DrawOp[] {
  if (!layers.length) return ops;
  const byKey = new Map<string, DrawOp>();
  for (const o of ops) if (o.key) byKey.set(o.key, o);
  const out: DrawOp[] = [];
  const seen = new Set<string>();
  const knownAll = new Set(layers.flatMap((l) => l.keys));
  for (const l of layers) {
    if (!l.visible) continue;
    for (const k of l.keys) {
      const o = byKey.get(k);
      if (o && !seen.has(k)) {
        out.push(o);
        seen.add(k);
      }
    }
  }
  // orphan strokes (no layer owns them) stay visible in array order
  for (const o of ops) {
    if (!o.key || (!seen.has(o.key) && !knownAll.has(o.key))) out.push(o);
  }
  return out;
}

// reading all drawings, empty list if none yet
export function loadAll(): Drawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
}

// saving whole list back, capped so storage never grows forever
function saveAll(list: Drawing[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    // quota full, keeping memory copy only for this visit
  }
}

// making a fresh drawing after user picks mode and size
export function createDrawing(mode: Mode, size: BoardSize = { w: BOARD_SIZE, h: BOARD_SIZE }): Drawing {
  const d: Drawing = {
    id: crypto.randomUUID(),
    title: mode === "svg" ? "Untitled SVG" : "Untitled sketch",
    mode,
    size: cleanSize(size.w, size.h),
    ops: [],
    layers: [blankLayer("Layer 1")],
    grid: cleanGrid(undefined),
    chat: [],
    intent: "build",
    updatedAt: Date.now(),
  };
  const all = loadAll();
  saveAll([d, ...all]);
  return d;
}

export function getDrawing(id: string): Drawing | null {
  return loadAll().find((d) => d.id === id) || null;
}

// saving silently on every change, so refresh never loses work
export function saveDrawing(d: Drawing) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === d.id);
  const next = { ...d, updatedAt: Date.now() };
  if (i === -1) saveAll([next, ...all]);
  else {
    all[i] = next;
    saveAll(all);
  }
}

export function removeDrawing(id: string) {
  saveAll(loadAll().filter((d) => d.id !== id));
}
