import { NextResponse } from "next/server";

// defaults when settings are empty, env still wins as fallback
const ENV_BASE =
  process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const ENV_MODEL =
  process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct";

// models retired by their hosts, asked-for id remaps to the live default
const RETIRED_MODELS = new Set(["meta/llama-3.1-70b-instruct"]);

// one readable line out of a provider error body
function shortDetail(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const d = j.detail || j.title || j.error?.message;
    if (d) return String(d).slice(0, 160);
  } catch {
    // not json, falling back to the raw slice below
  }
  return raw.slice(0, 160).replace(/\s+/g, " ");
}
const ENV_KEY = process.env.NVIDIA_API_KEY || "";

// picking endpoint per provider chosen in settings
// nvidia, openai and gemini speak the openai chat format, anthropic has its own
function resolveBase(provider: string, baseUrl: string): string {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai";
  if (provider === "custom") return (baseUrl || "").replace(/\/$/, "");
  return (baseUrl || ENV_BASE).replace(/\/$/, "");
}

// anthropic messages api call, returns the raw text reply
async function anthropicText(
  key: string,
  model: string,
  sys: string,
  history: { role: string; content: string }[],
  prompt: string
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: sys,
      messages: [...history, { role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const block = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string; text?: string }) => b.type === "text")
    : null;
  return typeof block?.text === "string" ? block.text : null;
}

// anthropic vision call with a base64 screenshot alongside the request
async function anthropicVision(
  key: string,
  model: string,
  sys: string,
  history: { role: string; content: string }[],
  shotText: string,
  imageB64: string
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: sys,
      messages: [
        ...history,
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
            { type: "text", text: shotText },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const block = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string; text?: string }) => b.type === "text")
    : null;
  return typeof block?.text === "string" ? block.text : null;
}

// keeping only real turns, newest last, capped so prompts stay small
// our own status lines ("added 3 strokes") carry no meaning for the model
const STATUS_LINE = /^(added \d+ (strokes|artwork)|nothing came back|no plan came back)/i;
function cleanHistory(raw: unknown): { role: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: string; content: string }[] = [];
  for (const h of raw.slice(-10)) {
    if (!h || typeof h !== "object") continue;
    const m = h as Record<string, unknown>;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content || "").slice(0, 2000);
    if (!content || STATUS_LINE.test(content)) continue;
    out.push({ role, content });
  }
  return out.slice(-10);
}

// fallback when no key or NIM fails, so board still works
function mockOps(prompt: string) {
  const color = "#ff0000";
  if (/circle|round/i.test(prompt)) {
    return [
      { op: "circle", tool: "brush", color, strokeWidth: 5, fill: false, center: [500, 500], r: 120 },
    ];
  }
  if (/house|home|hut/i.test(prompt)) {
    return [
      { op: "rect", tool: "brush", color, strokeWidth: 5, fill: false, center: [500, 600], w: 300, h: 200 },
      { op: "line", tool: "brush", color, strokeWidth: 5, from: [350, 500], to: [500, 380] },
      { op: "line", tool: "brush", color, strokeWidth: 5, from: [650, 500], to: [500, 380] },
      { op: "rect", tool: "brush", color, strokeWidth: 4, fill: false, center: [500, 630], w: 60, h: 90 },
    ];
  }
  return [
    { op: "line", tool: "brush", color, strokeWidth: 8, from: [420, 500], to: [580, 500] },
    { op: "bezier", tool: "brush", color, strokeWidth: 6, from: [420, 500], cp1: [480, 420], cp2: [540, 580], to: [600, 500] },
  ];
}

// scaling 1000-grid demo ops onto the real paper size
function fitMock(ops: unknown[], bw: number, bh: number): unknown[] {
  const sx = bw / 1000;
  const sy = bh / 1000;
  const pt = (p: unknown) =>
    Array.isArray(p) ? [Math.round(Number(p[0]) * sx), Math.round(Number(p[1]) * sy)] : p;
  const num = (n: unknown, f: number) => Math.max(1, Math.round(Number(n) * f));
  return ops.map((o) => {
    if (!o || typeof o !== "object") return o;
    const m = { ...(o as Record<string, unknown>) };
    for (const k of ["from", "to", "center", "cp1", "cp2"]) if (k in m) m[k] = pt(m[k]);
    if (Array.isArray(m.points)) m.points = (m.points as unknown[]).map(pt);
    for (const k of ["r", "rx", "strokeWidth", "size"]) if (typeof m[k] === "number") m[k] = num(m[k], (sx + sy) / 2);
    if (typeof m.w === "number") m.w = num(m.w, sx);
    if (typeof m.h === "number") m.h = num(m.h, sy);
    return m;
  });
}

// clamping a board point into bounds, falling back when garbage
function cleanPoint(p: unknown, fb: [number, number], bx: number, by: number): [number, number] {
  if (!Array.isArray(p)) return fb;
  const x = Math.round(Number(p[0]));
  const y = Math.round(Number(p[1]));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fb;
  return [Math.min(bx, Math.max(0, x)), Math.min(by, Math.max(0, y))];
}

// clamping a positive size
function cleanNum(n: unknown, fb: number, max: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fb;
  return Math.min(max, Math.max(1, v));
}

// translucency 0.05-1, solid when missing
function cleanOpacity(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.05, Math.round(n * 100) / 100));
}

// keeping only key strings so deletes and copies cannot touch anything else
function cleanKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((k) => String(k))
    .filter((k) => k && k.length < 80)
    .slice(0, 20);
}

// light server-side clean, browser does the strict pass before render
function lightCleanSvg(s: string): string {
  let t = String(s || "");
  const fenced = t.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  t = fenced ? fenced[1] : t;
  const a = t.indexOf("<");
  const b = t.lastIndexOf(">");
  t = a !== -1 && b > a ? t.slice(a, b + 1) : "";
  t = t.replace(/<\s*svg[^>]*>|<\s*\/\s*svg\s*>/gi, "");
  t = t.replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  t = t.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  t = t.replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "");
  t = t.replace(/javascript\s*:/gi, "");
  return t.trim().slice(0, 20000);
}

// keeping only sane ops with safe defaults, so bad ai json never crashes the board
function cleanOps(raw: unknown, bx: number, by: number): unknown[] {
  if (!Array.isArray(raw)) return [];
  const cx = Math.round(bx / 2);
  const cy = Math.round(by / 2);
  const big = Math.max(bx, by);
  const out: unknown[] = [];
  for (const o of raw.slice(0, 30)) {
    if (!o || typeof o !== "object") continue;
    const m = o as Record<string, unknown>;
    const kind = String(m.op || "");
    if (!["line", "polyline", "bezier", "circle", "rect", "text", "svg", "ellipse", "triangle", "star", "arrow"].includes(kind)) continue;
    if (kind === "svg") {
      const cleaned = lightCleanSvg(String(m.markup || ""));
      if (!cleaned) continue;
      out.push({ op: "svg", tool: "brush", markup: cleaned });
      continue;
    }
    const tool = m.tool === "eraser" ? "eraser" : "brush";
    const color = /^#[0-9a-fA-F]{6}$/.test(String(m.color || "")) ? String(m.color) : "#ff0000";
    const opacity = cleanOpacity(m.opacity);
    const sheer = opacity < 1 ? { opacity } : {};
    const base = { op: kind, tool, color };
    if (kind === "text") {
      const content = String(m.content || "").trim().slice(0, 120);
      if (!content) continue;
      out.push({ ...base, ...sheer, center: cleanPoint(m.center, [cx, cy], bx, by), size: cleanNum(m.size, 40, 200), content });
      continue;
    }
    const strokeWidth = cleanNum(m.strokeWidth, 5, 60);
    if (kind === "line") {
      out.push({ ...base, ...sheer, strokeWidth, from: cleanPoint(m.from, [cx - 50, cy], bx, by), to: cleanPoint(m.to, [cx + 50, cy], bx, by) });
    } else if (kind === "polyline") {
      const pts = Array.isArray(m.points)
        ? m.points.slice(0, 200).map((p) => cleanPoint(p, [cx, cy], bx, by))
        : [];
      if (pts.length < 2) continue;
      out.push({ ...base, ...sheer, strokeWidth, points: pts });
    } else if (kind === "bezier") {
      out.push({
        ...base, ...sheer, strokeWidth,
        from: cleanPoint(m.from, [cx - 50, cy], bx, by),
        cp1: cleanPoint(m.cp1, [cx - 20, cy - 30], bx, by),
        cp2: cleanPoint(m.cp2, [cx + 20, cy + 30], bx, by),
        to: cleanPoint(m.to, [cx + 50, cy], bx, by),
      });
    } else if (kind === "circle") {
      out.push({ ...base, ...sheer, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [cx, cy], bx, by), r: cleanNum(m.r, 60, big) });
    } else if (kind === "ellipse") {
      out.push({ ...base, ...sheer, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [cx, cy], bx, by), rx: cleanNum(m.rx, 80, big), ry: cleanNum(m.ry, 50, big) });
    } else if (kind === "triangle") {
      out.push({
        ...base, ...sheer, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [cx, cy], bx, by),
        w: cleanNum(m.w, 120, big), h: cleanNum(m.h, 100, big),
      });
    } else if (kind === "star") {
      out.push({ ...base, ...sheer, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [cx, cy], bx, by), r: cleanNum(m.r, 70, big) });
    } else if (kind === "arrow") {
      out.push({ ...base, ...sheer, strokeWidth, from: cleanPoint(m.from, [cx - 60, cy], bx, by), to: cleanPoint(m.to, [cx + 60, cy], bx, by) });
    } else {
      out.push({
        ...base, ...sheer, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [cx, cy], bx, by),
        w: cleanNum(m.w, 120, big), h: cleanNum(m.h, 80, big),
      });
    }
  }
  return out;
}

// cloning a canvas stroke with an offset and a fresh key, for "copy that shape"
function shiftOp(o: Record<string, unknown>, dx: number, dy: number, bx: number, by: number): Record<string, unknown> | null {
  const kind = String(o.op || "");
  if (kind === "svg") return { ...o, key: crypto.randomUUID() };
  if (!["line", "polyline", "bezier", "circle", "rect", "text", "ellipse", "triangle", "star", "arrow"].includes(kind)) return null;
  const mv = (p: unknown) => {
    if (!Array.isArray(p)) return p;
    return cleanPoint([Number(p[0]) + dx, Number(p[1]) + dy], [0, 0], bx, by);
  };
  const m: Record<string, unknown> = { ...o, key: crypto.randomUUID() };
  for (const k of ["from", "to", "center", "cp1", "cp2"]) if (k in m) m[k] = mv(m[k]);
  if (Array.isArray(m.points)) m.points = (m.points as unknown[]).slice(0, 200).map(mv);
  return m;
}

// pulling JSON out even if model adds markdown fences
function extractJson(text: string): { ops?: unknown; plan?: unknown; questions?: unknown; say?: unknown; replace?: unknown; deleteKeys?: unknown; duplicate?: unknown; grid?: unknown } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
}

// telling the board whether a server key exists, so demo mode is honest
export async function GET() {
  return NextResponse.json({ hasServerKey: Boolean(ENV_KEY) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").slice(0, 500);
  const mode = body.mode === "svg" ? "svg" : "brush-ops";
  // paper size from the board, clamped to sane bounds
  const rawSize = body.size as { w?: unknown; h?: unknown } | undefined;
  const bw = Math.min(4000, Math.max(100, Math.round(Number(rawSize?.w)) || 1000));
  const bh = Math.min(4000, Math.max(100, Math.round(Number(rawSize?.h)) || 1000));

  // client settings win, env is fallback, retired ids remap to the live default
  const provider = String(body.provider || "nvidia");
  const key = String(body.apiKey || "").trim() || ENV_KEY;
  const hadKey = Boolean(key);
  const asked = String(body.model || "").trim();
  const model = (asked && !RETIRED_MODELS.has(asked) ? asked : "") || ENV_MODEL;
  const base = resolveBase(provider, String(body.baseUrl || ""));
  const intent = body.intent === "plan" ? "plan" : body.intent === "refine" ? "refine" : ("build" as const);
  const history = cleanHistory(body.history);

  // current canvas for edits, trimmed so prompts stay small
  function cleanCanvas(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-40).map((o) => {
      if (!o || typeof o !== "object") return null;
      const m = { ...(o as Record<string, unknown>) };
      if (typeof m.markup === "string") m.markup = m.markup.slice(0, 500);
      if (Array.isArray(m.points)) m.points = (m.points as unknown[]).slice(0, 60);
      return m;
    });
  }
  const canvas = cleanCanvas(body.canvas);

  // sample plan so plan mode works with no key too
  function mockPlan() {
    return {
      plan: "I will draw your idea centered on the board: main shape in the middle, details around it, red strokes first.",
      questions: [
        { id: "q1", text: "Which style?", multi: false, allowText: true, options: ["Minimal", "Playful", "Detailed"] },
        { id: "q2", text: "Which colors?", multi: true, allowText: true, options: ["Red", "Blue", "Black"] },
      ],
    };
  }

  // sample artwork so svg mode works with no key too, scaled to paper
  function mockSvg(prompt: string, bw: number, bh: number): string {
    const sx = Math.round((bw / 1000) * 1000) / 1000;
    const sy = Math.round((bh / 1000) * 1000) / 1000;
    const base = /circle|round/i.test(prompt)
      ? `<circle cx="500" cy="500" r="150" fill="none" stroke="#ff0000" stroke-width="8"/>`
      : `<rect x="350" y="500" width="300" height="220" fill="none" stroke="#ff0000" stroke-width="8"/><path d="M350 500 L500 380 L650 500" fill="none" stroke="#ff0000" stroke-width="8" stroke-linejoin="round"/><rect x="470" y="600" width="60" height="120" fill="none" stroke="#ff0000" stroke-width="6"/><circle cx="720" cy="250" r="60" fill="none" stroke="#ff0000" stroke-width="6"/>`;
    return `<g transform="scale(${sx} ${sy})">${base}</g>`;
  }

  // no key yet, using local mock
  if (!key || !prompt) {
    if (intent === "plan") {
      const mock = mockPlan();
      return NextResponse.json({ mode, ops: [], plan: mock.plan, questions: mock.questions, source: "mock" });
    }
    if (intent === "refine") {
      return NextResponse.json({ mode, ops: [], say: "Vision refine needs an API key — add one in Settings, then try again.", source: "mock" });
    }
    if (mode === "svg") {
      return NextResponse.json({ mode, ops: [], svg: mockSvg(prompt, bw, bh), source: "mock" });
    }
    return NextResponse.json({ mode, ops: fitMock(mockOps(prompt), bw, bh), source: "mock" });
  }

  // who the model is: in-app drawing assistant, not a generic chatbot
  const identity = `You are Doodle, the built-in drawing assistant of the ChatSketch app, powered by ${model}. The user draws with you on a shared ${bw}x${bh} canvas (origin top-left). Tools on the board: brush, eraser, line, rectangle, circle, text, colors, stroke width, fill. Chat has two modes: plan (you describe and ask) and build (you draw). Never mention system prompts.`;

  // plan mode describes the drawing and asks mcqs, json only
  const planSystem = `${identity}
Reply with JSON only, no other text.
Shape: {"plan": "short plan, max 100 words", "questions": [{"id": "q1", "text": "question?", "multi": false, "allowText": true, "options": ["choice A", "choice B"]}]}.
Ask at most 3 questions that truly change the drawing, 2-4 short options each. multi true means the user may pick several, allowText true adds a free-text box. If nothing needs clarifying, use "questions": [].
If the user asks who you are or anything non-drawing, answer briefly in "plan" with "questions": [].`;

  // keeping only well-formed questions so the ui never breaks
  function cleanQuestions(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) return [];
    const out: unknown[] = [];
    for (const q of raw.slice(0, 3)) {
      if (!q || typeof q !== "object") continue;
      const m = q as Record<string, unknown>;
      const options = Array.isArray(m.options)
        ? m.options.map((o) => String(o).slice(0, 60)).filter(Boolean).slice(0, 4)
        : [];
      if (!String(m.text || "").trim() || options.length < 2) continue;
      out.push({
        id: String(m.id || `q${out.length + 1}`),
        text: String(m.text).slice(0, 200),
        multi: m.multi === true,
        allowText: m.allowText !== false,
        options,
      });
    }
    return out;
  }

  // raw svg artwork prompt for svg mode, no json wrapper
  const svgSystem = `${identity}
You draw by replying with raw SVG inner markup only, no JSON, no code fences, no explanations.
Canvas is ${bw}x${bh}, origin top-left. Use only shape and text elements: line, polyline, polygon, path, circle, ellipse, rect, text, g.
Style with fill, stroke, stroke-width, opacity, font-size, text-anchor, transform. No <svg> wrapper, no scripts, no event handlers, no links.
Current canvas: ${canvas.length ? JSON.stringify(canvas).slice(0, 6000) : "empty"}. If the user asks to change it, start your reply with REPLACE: on its own line, then the COMPLETE new markup including kept artwork.
If the user greets you or asks anything non-drawing, reply with plain text starting with SAY: followed by your short answer as Doodle.`;
  const system = `${identity}
You draw by replying with JSON only, no other text.
Shape: {"mode":"${mode}","ops":[...],"say":"optional short message"}
Each op is one of:
{"op":"line","tool":"brush","color":"#ff0000","strokeWidth":5,"from":[x,y],"to":[x,y]}
{"op":"polyline","tool":"brush","color":"#ff0000","strokeWidth":5,"points":[[x,y],[x,y]]}
{"op":"bezier","tool":"brush","color":"#ff0000","strokeWidth":4,"from":[x,y],"cp1":[x,y],"cp2":[x,y],"to":[x,y]}
{"op":"circle","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"r":80}
{"op":"rect","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"w":200,"h":120}
{"op":"text","tool":"brush","color":"#ff0000","center":[x,y],"size":40,"content":"hello"}
{"op":"ellipse","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"rx":100,"ry":60}
{"op":"triangle","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"w":160,"h":140}
{"op":"star","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"r":90}
{"op":"arrow","tool":"brush","color":"#ff0000","strokeWidth":5,"from":[x,y],"to":[x,y]}
Keep coords 0-${bw}, 0-${bh}, max 20 ops, centered composition.
Current canvas ops: ${canvas.length ? JSON.stringify(canvas).slice(0, 6000) : "empty"}.
If the user asks to change the existing drawing (bigger, move, recolor, remove, add to it), return the COMPLETE new ops array including kept strokes, and set "replace": true. Otherwise return only the new strokes with "replace": false. Kept strokes must keep their exact "key" so layers survive.
To delete strokes say "deleteKeys": ["key", ...]. To copy strokes say "duplicate": {"keys": [...], "dx": 120, "dy": 0}. Add "opacity": 0.05-1 for translucent strokes, omit for solid. To change the paper grid say "grid": {"size": 100, "show": true, "snap": true} with only what changes.
If the user greets you, asks who you are, or asks anything non-drawing, return {"mode":"${mode}","ops":[],"say":"your short answer as Doodle"} instead.`;

  // screenshot for the vision loop, data url jpeg
  const image = String(body.image || "");
  if (intent === "refine" && (!image.startsWith("data:image/") || image.length > 3000000)) {
    return NextResponse.json({ mode, ops: [], say: "Could not read the board screenshot, try again.", source: "mock" });
  }
  const imageB64 = image.includes(",") ? image.split(",")[1] : image;

  // refine prompt: look at the screenshot, return the corrected full canvas
  const refineSystem = `${identity}
You see a screenshot of the user's current canvas plus their original request below. Reply with JSON only, no other text.
Shape: {"mode":"${mode}","ops":[...],"replace":true}
Each op is one of:
{"op":"line","tool":"brush","color":"#ff0000","strokeWidth":5,"from":[x,y],"to":[x,y]}
{"op":"polyline","tool":"brush","color":"#ff0000","strokeWidth":5,"points":[[x,y],[x,y]]}
{"op":"bezier","tool":"brush","color":"#ff0000","strokeWidth":4,"from":[x,y],"cp1":[x,y],"cp2":[x,y],"to":[x,y]}
{"op":"circle","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"r":80}
{"op":"rect","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"w":200,"h":120}
{"op":"text","tool":"brush","color":"#ff0000","center":[x,y],"size":40,"content":"hello"}
{"op":"ellipse","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"rx":100,"ry":60}
{"op":"triangle","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"w":160,"h":140}
{"op":"star","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[x,y],"r":90}
{"op":"arrow","tool":"brush","color":"#ff0000","strokeWidth":5,"from":[x,y],"to":[x,y]}
Keep coords 0-${bw}, 0-${bh}, max 30 ops. Return the COMPLETE corrected canvas: keep good strokes with exact keys, fix proportions, alignment, gaps and colors to match the request. Always set "replace": true. If nothing needs fixing, echo the canvas ops unchanged. Add "opacity": 0.05-1 for translucent strokes. Say "grid": {"size": 100, "show": true, "snap": true} to change the paper grid.`;

  try {
    // svg mode gets raw markup, everything else gets ops json
    const wantSvg = mode === "svg" && (intent === "build" || intent === "refine");
    // vision user block: screenshot plus request text
    const visionText = `Original request: ${prompt || "improve this drawing"}. The screenshot shows the current canvas.`;
    // anthropic speaks its own messages format
    let text = "";
    if (provider === "anthropic") {
      const sys = intent === "plan" ? planSystem : wantSvg ? svgSystem : intent === "refine" ? refineSystem : system;
      if (intent === "refine") {
        text = (await anthropicVision(key, model, sys, history, visionText, imageB64)) || "";
      } else {
        text = (await anthropicText(key, model, sys, history, prompt)) || "";
      }
    } else {
      const sys = intent === "plan" ? planSystem : wantSvg ? svgSystem : intent === "refine" ? refineSystem : system;
      const userBlock =
        intent === "refine"
          ? [{ role: "user", content: [{ type: "text", text: visionText }, { type: "image_url", image_url: { url: image } }] }]
          : [{ role: "user", content: prompt }];
      const chatBody =
        intent === "plan"
          ? {
              model,
              messages: [...history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content: prompt }],
              temperature: 0.4,
              max_tokens: 800,
            }
          : {
              model,
              messages: [
                { role: "system", content: sys },
                ...history.map((h) => ({ role: h.role, content: h.content })),
                ...userBlock,
              ],
              temperature: wantSvg || intent === "refine" ? 0.4 : 0.2,
              max_tokens: 2000,
            };
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(chatBody),
      });

      if (!res.ok) {
        // provider refused (bad key, dead model, quota), saying so beats silent demo
        if (hadKey) {
          const raw = await res.text().catch(() => "");
          const why = shortDetail(raw);
          const hint = `Doodle could not draw: provider error ${res.status}${why ? ` — ${why}` : ""}. Check the key and model in Settings.`;
          if (intent === "plan") {
            return NextResponse.json({ mode, ops: [], plan: hint, questions: [], source: provider });
          }
          return NextResponse.json({ mode, ops: [], say: hint.slice(0, 500), source: provider });
        }
        // no key, falling back so UI does not break
        return NextResponse.json({ mode, ops: fitMock(mockOps(prompt), bw, bh), source: "mock" });
      }

      const data = await res.json();
      text = data?.choices?.[0]?.message?.content || "";
    }

    // provider answered with nothing usable, saying so when a key was given
    if (!text && hadKey) {
      const hint = "Doodle could not draw: the provider gave nothing back. Try again or pick another model in Settings.";
      if (intent === "plan") {
        return NextResponse.json({ mode, ops: [], plan: hint, questions: [], source: provider });
      }
      return NextResponse.json({ mode, ops: [], say: hint, source: provider });
    }

    // plan mode returns text plus mcq questions
    if (intent === "plan") {
      const parsed = extractJson(text);
      const plan =
        typeof parsed.plan === "string" && parsed.plan.trim()
          ? parsed.plan.trim().slice(0, 1000)
          : text.trim().slice(0, 1000);
      return NextResponse.json({ mode, ops: [], plan, questions: cleanQuestions(parsed.questions), source: provider });
    }

    // svg mode returns raw markup for direct injection
    if (wantSvg) {
      // spoken reply for greetings, prefixed with SAY:
      const sayMatch = text.match(/^\s*SAY:\s*([\s\S]*)$/im);
      if (sayMatch) {
        return NextResponse.json({ mode, ops: [], say: sayMatch[1].trim().slice(0, 500), source: provider });
      }
      const svg = lightCleanSvg(text.replace(/^\s*REPLACE:.*$/im, ""));
      if (!svg) {
        return NextResponse.json({ mode, ops: fitMock(mockOps(prompt), bw, bh), source: "mock" });
      }
      // REPLACE: prefix means new markup includes the old artwork
      const replace = /^\s*REPLACE:/im.test(text);
      return NextResponse.json({ mode, ops: [], svg, replace, source: provider });
    }

    const parsed = extractJson(text);
    const ops = cleanOps(parsed.ops, bw, bh);
    // short spoken reply for greetings and questions, shown in chat
    const say = typeof parsed.say === "string" ? parsed.say.trim().slice(0, 500) : "";
    // refine always replaces: the model returns the whole corrected canvas
    const replace = intent === "refine" ? ops.length > 0 : parsed.replace === true;
    // strokes the model asked to remove, by key
    const deleteKeys = cleanKeys(parsed.deleteKeys);
    // strokes the model asked to copy, cloned with an offset and fresh keys
    let duplicate: unknown[] = [];
    const dq = (parsed.duplicate || {}) as Record<string, unknown>;
    const dupKeys = new Set(cleanKeys(dq.keys));
    if (dupKeys.size) {
      const numOr = (v: unknown, fb: number) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(2000, Math.max(-2000, n)) : fb;
      };
      const ddx = dq.dx === undefined ? 120 : numOr(dq.dx, 120);
      const ddy = dq.dy === undefined ? 0 : numOr(dq.dy, 0);
      const byKey = new Map<string, unknown>();
      for (const o of canvas) {
        if (o && typeof o === "object") {
          const k = String((o as Record<string, unknown>).key || "");
          if (k) byKey.set(k, o);
        }
      }
      for (const k of dupKeys) {
        const o = byKey.get(k);
        if (o && typeof o === "object") {
          const c = shiftOp(o as Record<string, unknown>, ddx, ddy, bw, bh);
          if (c) duplicate.push(c);
        }
      }
      duplicate = duplicate.slice(0, 20);
    }
    // grid change the model asked for, merged over the current one
    let gridEcho: unknown = undefined;
    if (parsed.grid && typeof parsed.grid === "object") {
      const cur = (body.grid || {}) as Record<string, unknown>;
      const asked = parsed.grid as Record<string, unknown>;
      const gsize = (v: unknown, fb: number) => {
        if (v === undefined) return fb;
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(500, Math.max(10, n)) : fb;
      };
      const curSize = Math.round(Number((cur as Record<string, unknown>).size));
      gridEcho = {
        size: gsize(asked.size, Number.isFinite(curSize) ? Math.min(500, Math.max(10, curSize)) : 100),
        show: asked.show === undefined ? (cur as Record<string, unknown>).show === true : asked.show === true,
        snap: asked.snap === undefined ? (cur as Record<string, unknown>).snap === true : asked.snap === true,
      };
    }
    if (!ops.length && !say && !deleteKeys.length && !duplicate.length && !gridEcho) {
      return NextResponse.json({ mode, ops: fitMock(mockOps(prompt), bw, bh), source: "mock" });
    }
    return NextResponse.json({ mode, ops, say, replace, deleteKeys, duplicate, grid: gridEcho, source: provider });
  } catch {
    // network issue: with a key we say so, without one we still demo something drawable
    if (hadKey) {
      const hint = "Doodle could not draw: could not reach the provider. Check your connection and try again.";
      if (intent === "plan") {
        return NextResponse.json({ mode, ops: [], plan: hint, questions: [], source: "mock" });
      }
      return NextResponse.json({ mode, ops: [], say: hint, source: "mock" });
    }
    return NextResponse.json({ mode, ops: fitMock(mockOps(prompt), bw, bh), source: "mock" });
  }
}
