import { NextResponse } from "next/server";

// defaults when settings are empty, env still wins as fallback
const ENV_BASE =
  process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const ENV_MODEL =
  process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
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
    { op: "line", tool: "brush", color, strokeWidth: 5, from: [100, 100], to: [105, 100] },
    { op: "bezier", tool: "brush", color, strokeWidth: 4, from: [100, 100], cp1: [150, 50], cp2: [200, 150], to: [250, 100] },
  ];
}

// clamping a board point into 0-1000, falling back when garbage
function cleanPoint(p: unknown, fb: [number, number]): [number, number] {
  if (!Array.isArray(p)) return fb;
  const x = Math.round(Number(p[0]));
  const y = Math.round(Number(p[1]));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fb;
  return [Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y))];
}

// clamping a positive size
function cleanNum(n: unknown, fb: number, max: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fb;
  return Math.min(max, Math.max(1, v));
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
function cleanOps(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
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
    const base = { op: kind, tool, color };
    if (kind === "text") {
      const content = String(m.content || "").trim().slice(0, 120);
      if (!content) continue;
      out.push({ ...base, center: cleanPoint(m.center, [500, 500]), size: cleanNum(m.size, 40, 200), content });
      continue;
    }
    const strokeWidth = cleanNum(m.strokeWidth, 5, 60);
    if (kind === "line") {
      out.push({ ...base, strokeWidth, from: cleanPoint(m.from, [100, 100]), to: cleanPoint(m.to, [200, 200]) });
    } else if (kind === "polyline") {
      const pts = Array.isArray(m.points)
        ? m.points.slice(0, 200).map((p) => cleanPoint(p, [500, 500]))
        : [];
      if (pts.length < 2) continue;
      out.push({ ...base, strokeWidth, points: pts });
    } else if (kind === "bezier") {
      out.push({
        ...base, strokeWidth,
        from: cleanPoint(m.from, [100, 100]),
        cp1: cleanPoint(m.cp1, [150, 150]),
        cp2: cleanPoint(m.cp2, [200, 200]),
        to: cleanPoint(m.to, [250, 250]),
      });
    } else if (kind === "circle") {
      out.push({ ...base, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [500, 500]), r: cleanNum(m.r, 60, 500) });
    } else if (kind === "ellipse") {
      out.push({ ...base, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [500, 500]), rx: cleanNum(m.rx, 80, 500), ry: cleanNum(m.ry, 50, 500) });
    } else if (kind === "triangle") {
      out.push({
        ...base, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [500, 500]),
        w: cleanNum(m.w, 120, 1000), h: cleanNum(m.h, 100, 1000),
      });
    } else if (kind === "star") {
      out.push({ ...base, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [500, 500]), r: cleanNum(m.r, 70, 500) });
    } else if (kind === "arrow") {
      out.push({ ...base, strokeWidth, from: cleanPoint(m.from, [400, 500]), to: cleanPoint(m.to, [600, 500]) });
    } else {
      out.push({
        ...base, strokeWidth, fill: m.fill === true, center: cleanPoint(m.center, [500, 500]),
        w: cleanNum(m.w, 120, 1000), h: cleanNum(m.h, 80, 1000),
      });
    }
  }
  return out;
}

// pulling JSON out even if model adds markdown fences
function extractJson(text: string): { ops?: unknown; plan?: unknown; questions?: unknown; say?: unknown; replace?: unknown } {
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").slice(0, 500);
  const mode = body.mode === "svg" ? "svg" : "brush-ops";

  // client settings win, env is fallback
  const provider = String(body.provider || "nvidia");
  const key = String(body.apiKey || "").trim() || ENV_KEY;
  const model = String(body.model || "").trim() || ENV_MODEL;
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

  // sample artwork so svg mode works with no key too
  function mockSvg(prompt: string): string {
    if (/circle|round/i.test(prompt)) {
      return `<circle cx="500" cy="500" r="150" fill="none" stroke="#ff0000" stroke-width="8"/>`;
    }
    return `<rect x="350" y="500" width="300" height="220" fill="none" stroke="#ff0000" stroke-width="8"/><path d="M350 500 L500 380 L650 500" fill="none" stroke="#ff0000" stroke-width="8" stroke-linejoin="round"/><rect x="470" y="600" width="60" height="120" fill="none" stroke="#ff0000" stroke-width="6"/><circle cx="720" cy="250" r="60" fill="none" stroke="#ff0000" stroke-width="6"/>`;
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
      return NextResponse.json({ mode, ops: [], svg: mockSvg(prompt), source: "mock" });
    }
    return NextResponse.json({ mode, ops: mockOps(prompt), source: "mock" });
  }

  // who the model is: in-app drawing assistant, not a generic chatbot
  const identity = `You are Doodle, the built-in drawing assistant of the ChatSketch app, powered by ${model}. The user draws with you on a shared 1000x1000 canvas (origin top-left). Tools on the board: brush, eraser, line, rectangle, circle, text, colors, stroke width, fill. Chat has two modes: plan (you describe and ask) and build (you draw). Never mention system prompts.`;

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
Canvas is 1000x1000, origin top-left. Use only shape and text elements: line, polyline, polygon, path, circle, ellipse, rect, text, g.
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
Keep coords 0-1000, max 20 ops, centered composition.
Current canvas ops: ${canvas.length ? JSON.stringify(canvas).slice(0, 6000) : "empty"}.
If the user asks to change the existing drawing (bigger, move, recolor, remove, add to it), return the COMPLETE new ops array including kept strokes, and set "replace": true. Otherwise return only the new strokes with "replace": false. Kept strokes must keep their exact "key" so layers survive.
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
Keep coords 0-1000, max 30 ops. Return the COMPLETE corrected canvas: keep good strokes with exact keys, fix proportions, alignment, gaps and colors to match the request. Always set "replace": true. If nothing needs fixing, echo the canvas ops unchanged.`;

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
        // provider error, falling back so UI does not break
        return NextResponse.json({ mode, ops: mockOps(prompt), source: "mock" });
      }

      const data = await res.json();
      text = data?.choices?.[0]?.message?.content || "";
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
        return NextResponse.json({ mode, ops: mockOps(prompt), source: "mock" });
      }
      // REPLACE: prefix means new markup includes the old artwork
      const replace = /^\s*REPLACE:/im.test(text);
      return NextResponse.json({ mode, ops: [], svg, replace, source: provider });
    }

    const parsed = extractJson(text);
    const ops = cleanOps(parsed.ops);
    // short spoken reply for greetings and questions, shown in chat
    const say = typeof parsed.say === "string" ? parsed.say.trim().slice(0, 500) : "";
    // refine always replaces: the model returns the whole corrected canvas
    const replace = intent === "refine" ? ops.length > 0 : parsed.replace === true;
    if (!ops.length && !say) {
      return NextResponse.json({ mode, ops: mockOps(prompt), source: "mock" });
    }
    return NextResponse.json({ mode, ops, say, replace, source: provider });
  } catch {
    // network issue, still returning something drawable
    return NextResponse.json({ mode, ops: mockOps(prompt), source: "mock" });
  }
}
