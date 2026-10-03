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

export type Tool = "brush" | "eraser" | "line" | "rect" | "circle" | "text" | "hand" | "ellipse" | "triangle" | "star" | "arrow" | "dropper";
export type Mode = "brush-ops" | "svg";

export type DrawOp =
  | { op: "line"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; to: [number, number] }
  | { op: "polyline"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; points: [number, number][] }
  | { op: "bezier"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; cp1: [number, number]; cp2: [number, number]; to: [number, number] }
  | { op: "circle"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; r: number }
  | { op: "rect"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; w: number; h: number }
  | { op: "text"; key?: string; tool: Tool; color: string; center: [number, number]; size: number; content: string }
  | { op: "svg"; key?: string; tool: Tool; markup: string }
  | { op: "ellipse"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; rx: number; ry: number }
  | { op: "triangle"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; w: number; h: number }
  | { op: "star"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; fill: boolean; center: [number, number]; r: number }
  | { op: "arrow"; key?: string; brush?: string; tool: Tool; color: string; strokeWidth: number; from: [number, number]; to: [number, number] };

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
