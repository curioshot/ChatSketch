"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import LiveSync, { type Peer } from "@/app/components/LiveSync";
import ShareModal from "@/app/components/ShareModal";
import {
  BOARD_SIZE,
  ChatMsg,
  DrawOp,
  Intent,
  Layer,
  Mode,
  PlanQuestion,
  Tool,
  arrowHead,
  blankLayer,
  brushPasses,
  getDrawing,
  orderedVisibleOps,
  saveDrawing,
  sizeLabel,
  starPoints,
  triPoints,
} from "@/lib/drawings";
import { contextLimit, estimateTokens, formatTokens } from "@/lib/context";
import { sanitizeSvgInner } from "@/lib/svg";
import { downloadChat, downloadJpg, downloadPdf, downloadPng, downloadSvg, opsToSvg, rasterize } from "@/lib/export";
import { BgImage, fileToBg, fitBg } from "@/lib/image";
import { applySettings, loadSettings, saveSettings } from "@/lib/settings";
import ChatText from "@/app/components/ChatText";
import LayersPanel from "@/app/components/LayersPanel";
import Logo from "@/app/components/Logo";

// one mcq block: single or multi picks plus optional free text
function McqSet({
  questions,
  onSubmit,
}: {
  questions: PlanQuestion[];
  onSubmit: (summary: string) => void;
}) {
  // picks per question id
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  // free text per question id
  const [texts, setTexts] = useState<Record<string, string>>({});

  // toggling one option, single-choice replaces, multi adds/removes
  function toggle(q: PlanQuestion, opt: string) {
    setPicks((prev) => {
      const cur = prev[q.id] || [];
      if (q.multi) {
        return { ...prev, [q.id]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
      }
      return { ...prev, [q.id]: [opt] };
    });
  }

  // building one answer line per question
  function submit() {
    const lines = questions.map((q) => {
      const picked = (picks[q.id] || []).join(", ") || "skipped";
      const extra = (texts[q.id] || "").trim();
      return `${q.text} -> ${picked}${extra ? ` (note: ${extra})` : ""}`;
    });
    onSubmit(`My answers:\n${lines.join("\n")}`);
  }

  const answered = questions.some((q) => (picks[q.id] || []).length || (texts[q.id] || "").trim());

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
      {questions.map((q) => {
        const cur = picks[q.id] || [];
        return (
          <div key={q.id}>
            <p className="text-xs font-medium">
              {q.text}
              {q.multi && <span className="ml-1 font-normal text-gray-500">pick many</span>}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const on = cur.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => toggle(q, opt)}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {q.allowText && (
              <input
                value={texts[q.id] || ""}
                onChange={(e) => setTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="or type your own..."
                aria-label={`your own answer for ${q.text}`}
                className="mt-1.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none transition-colors focus:border-black dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-white"
              />
            )}
          </div>
        );
      })}
      <button
        onClick={submit}
        disabled={!answered}
        className="w-full rounded-lg bg-black py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-black"
      >
        Send answers
      </button>
    </div>
  );
}

// minimal speech recognition shapes, browsers differ on names
type SpeechTalkerEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type SpeechTalker = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechTalkerEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechTalkerCtor = new () => SpeechTalker;

// in-progress stroke, committed as one op on release so lines stay smooth
type Draft =
  | { kind: "free"; points: [number, number][] }
  | { kind: "line"; from: [number, number]; to: [number, number] }
  | { kind: "rect"; from: [number, number]; to: [number, number] }
  | { kind: "circle"; from: [number, number]; to: [number, number] }
  | { kind: "ellipse"; from: [number, number]; to: [number, number] }
  | { kind: "triangle"; from: [number, number]; to: [number, number] }
  | { kind: "star"; from: [number, number]; to: [number, number] }
  | { kind: "arrow"; from: [number, number]; to: [number, number] };

// shared look for toolbar buttons
const toolBtn = (active: boolean) =>
  `rounded-lg p-2 transition-colors ${active ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-gray-100 dark:hover:bg-neutral-800"}`;

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">loading...</div>}>
      <BoardShell />
    </Suspense>
  );
}

// room shell: same board, optionally inside a liveblocks room
// rulers treat 96 board units as one inch, like css pixels
type RulerUnit = "px" | "mm" | "cm" | "in";
const UNIT_KEY = "ai-board-ruler-unit-v1";
function toUnit(px: number, u: RulerUnit): number {
  if (u === "mm") return (px * 25.4) / 96;
  if (u === "cm") return (px * 2.54) / 96;
  if (u === "in") return px / 96;
  return px;
}
// short label for a board value in the picked unit
function fmtUnit(px: number, u: RulerUnit): string {
  const v = toUnit(px, u);
  if (u === "px") return String(Math.round(v));
  if (u === "in") return String(Math.round(v * 100) / 100);
  return String(Math.round(v * 10) / 10);
}
// nice labeled step so ticks land about 80 css px apart
function niceStep(boardPer80px: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(boardPer80px)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= boardPer80px) return m * pow;
  return 10 * pow;
}
function BoardShell() {
  const params = useParams();
  const sp = useSearchParams();
  const id = String(params.id || "");
  const [live, setLive] = useState(sp.get("live") === "1");
  const canLive = process.env.NEXT_PUBLIC_LIVE_ENABLED === "true";
  const roomId = (`chatsketch-${id}`.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 80) || "chatsketch-lobby");
  if (!live || !canLive) return <BoardInner live={false} setLive={setLive} canLive={canLive} />;
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={roomId}
        initialPresence={{ cursor: null, name: "", color: "" }}
        initialStorage={{ doc: "" }}
      >
        <BoardInner live={live} setLive={setLive} canLive={canLive} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function BoardInner({ live, setLive, canLive }: { live: boolean; setLive: (v: boolean) => void; canLive: boolean }) {
  const params = useParams();
  const id = String(params.id || "");
  // all strokes live here
  const [ops, setOps] = useState<DrawOp[]>([]);
  // layers own strokes by key, painted top to bottom
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState("");
  // mirror for timeouts and updaters that outlive renders
  const activeRef = useRef("");
  useEffect(() => {
    activeRef.current = activeLayerId;
  }, [activeLayerId]);
  // layers panel open or not
  const [layersOpen, setLayersOpen] = useState(false);
  // live room peers and share dialog
  const [peers, setPeers] = useState<Peer[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  // export menu open or not
  const [exportOpen, setExportOpen] = useState(false);

  // exporting the current board, svg mode offers svg only
  async function exportBoard(fmt: "pdf" | "jpg" | "png" | "svg") {
    const drawing = { id, title: title || "Untitled", mode, size, ops, layers, bg: bg || undefined, chat: [], intent: "build" as const, updatedAt: 0 };
    try {
      if (fmt === "pdf") await downloadPdf(drawing);
      else if (fmt === "jpg") await downloadJpg(drawing);
      else if (fmt === "png") await downloadPng(drawing);
      else downloadSvg(drawing);
    } catch {
      // rasterize can fail on odd markup, menu still closes
    }
    setExportOpen(false);
  }
  // photo underneath to trace over
  const [bg, setBg] = useState<BgImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // cached photo element, reloaded when src changes
  const bgImg = useRef<{ src: string; el: HTMLImageElement } | null>(null);
  // keeping removed strokes here for redo
  const [redoStack, setRedoStack] = useState<DrawOp[]>([]);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#ff0000");
  const [width, setWidth] = useState(5);
  // filling shapes or just outline
  const [fill, setFill] = useState(false);
  // brush tip style, pen is the plain default
  const [brushKind, setBrushKind] = useState("pen");
  const [brushOpen, setBrushOpen] = useState(false);
  // zoom + pan view, center in board coords
  const [view, setView] = useState({ s: 1, cx: 500, cy: 500 });
  // ruler unit, remembered per browser
  const [rulerUnit, setRulerUnit] = useState<RulerUnit>("px");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(UNIT_KEY);
      if (saved === "mm" || saved === "cm" || saved === "in" || saved === "px") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRulerUnit(saved);
      }
    } catch {
      // storage blocked, px stays
    }
  }, []);
  function pickUnit(u: RulerUnit) {
    setRulerUnit(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      // storage blocked, unit still applies for this visit
    }
  }
  // live cursor in board coords, for the readout
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  // active pan drag in screen px, space bar held or not
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const spaceDown = useRef(false);
  const [mode, setMode] = useState<Mode>("brush-ops");
  // paper size picked at create, fixed for the drawing
  const [size, setSize] = useState({ w: BOARD_SIZE, h: BOARD_SIZE });
  const [title, setTitle] = useState("Untitled");
  const [ready, setReady] = useState(false);
  // unfinished stroke shown as preview
  const [draft, setDraft] = useState<Draft | null>(null);
  // where the text box sits, null when closed
  const [textAt, setTextAt] = useState<[number, number] | null>(null);
  const [textValue, setTextValue] = useState("");
  // left chat open or not
  const [chatOpen, setChatOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  // voice dictation state, only when the browser allows it
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const recRef = useRef<SpeechTalker | null>(null);

  // checking mic support after mount, ssr has no window
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechTalkerCtor; webkitSpeechRecognition?: SpeechTalkerCtor };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      recRef.current?.stop();
      recRef.current = null;
    };
  }, []);
  // session chat, restored per drawing below
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  // plan just describes, build draws
  const [intent, setIntent] = useState<Intent>("build");
  const [busy, setBusy] = useState(false);
  // provider model for the context meter, refreshed on focus
  const [meterModel, setMeterModel] = useState("");
  const [meterProvider, setMeterProvider] = useState("nvidia");
  // demo mode when no api key is saved anywhere
  const [hasKey, setHasKey] = useState(true);
  // reading replies aloud, from settings
  const [voiceOut, setVoiceOut] = useState(false);
  // inline model picker near the chat box
  const [modelOpen, setModelOpen] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelErr, setModelErr] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // clamping zoom and center so you cannot get lost
  function clampView(v: { s: number; cx: number; cy: number }) {
    return {
      s: Math.min(8, Math.max(0.5, v.s)),
      cx: Math.min(size.w + 200, Math.max(-200, v.cx)),
      cy: Math.min(size.h + 200, Math.max(-200, v.cy)),
    };
  }

  // measured board box in css px, for overlay positioning
  const [cssSize, setCssSize] = useState({ w: 1, h: 1 });

  // uniform meet-fit mapping shared by paint, pointer and overlays
  function viewGeom(cw: number, ch: number) {
    const vw = size.w / view.s;
    const vh = size.h / view.s;
    const s = Math.min(cw / vw, ch / vh);
    const ox = (cw - s * vw) / 2;
    const oy = (ch - s * vh) / 2;
    return { vw, vh, s, ox, oy };
  }

  // screen px to board coords through the current view
  function toBoardPx(px: number, py: number, r: DOMRect): [number, number] {
    const g = viewGeom(r.width, r.height);
    const bx = ((px - r.left - g.ox) / g.s) + (view.cx - g.vw / 2);
    const by = ((py - r.top - g.oy) / g.s) + (view.cy - g.vh / 2);
    // paper is the work area, strokes stop at its edge
    return [Math.min(size.w, Math.max(0, Math.round(bx))), Math.min(size.h, Math.max(0, Math.round(by)))];
  }

  // board coords to css percent for floating cursors and inputs
  function boardPct(x: number, y: number): { left: string; top: string } {
    const g = viewGeom(cssSize.w, cssSize.h);
    return {
      left: `${(((x - (view.cx - g.vw / 2)) * g.s + g.ox) / cssSize.w) * 100}%`,
      top: `${(((y - (view.cy - g.vh / 2)) * g.s + g.oy) / cssSize.h) * 100}%`,
    };
  }

  // converting pointer to board coords, using coalesced points for smooth curves
  function eventPoints(e: React.PointerEvent): [number, number][] {
    const box = boxRef.current!;
    const r = box.getBoundingClientRect();
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const raw =
      typeof native.getCoalescedEvents === "function" && native.getCoalescedEvents().length
        ? native.getCoalescedEvents()
        : [native];
    return raw.map((p) => toBoardPx(p.clientX, p.clientY, r));
  }

  // drawing one op on canvas in board units, shared by paint and draft preview
  function strokeOp(ctx: CanvasRenderingContext2D, o: DrawOp) {
    // injected svg only lives in svg mode, canvas never sees it
    if (o.op === "svg") return;
    // multi-pass styles like neon glow
    for (const pass of brushPasses(o)) {
      paintPass(ctx, o, pass.wMul, pass.alpha);
    }
    ctx.globalAlpha = 1;
  }

  // single pass of one op at a width multiplier and opacity
  function paintPass(ctx: CanvasRenderingContext2D, o: DrawOp, wMul: number, alpha: number) {
    if (o.op === "svg") return;
    const isErase = o.tool === "eraser";
    ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = o.color;
    ctx.fillStyle = o.color;
    if (o.op !== "text") ctx.lineWidth = o.strokeWidth * wMul;
    ctx.beginPath();
    if (o.op === "line") {
      ctx.moveTo(o.from[0], o.from[1]);
      ctx.lineTo(o.to[0], o.to[1]);
      ctx.stroke();
    } else if (o.op === "polyline") {
      o.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
    } else if (o.op === "bezier") {
      ctx.moveTo(o.from[0], o.from[1]);
      ctx.bezierCurveTo(o.cp1[0], o.cp1[1], o.cp2[0], o.cp2[1], o.to[0], o.to[1]);
      ctx.stroke();
    } else if (o.op === "circle") {
      ctx.beginPath();
      ctx.arc(o.center[0], o.center[1], o.r, 0, Math.PI * 2);
      if (o.fill) ctx.fill();
      else ctx.stroke();
    } else if (o.op === "rect") {
      const x = o.center[0] - o.w / 2;
      const y = o.center[1] - o.h / 2;
      if (o.fill) ctx.fillRect(x, y, o.w, o.h);
      else ctx.strokeRect(x, y, o.w, o.h);
    } else if (o.op === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(o.center[0], o.center[1], Math.max(1, o.rx), Math.max(1, o.ry), 0, 0, Math.PI * 2);
      if (o.fill) ctx.fill();
      else ctx.stroke();
    } else if (o.op === "triangle" || o.op === "star") {
      const pts = o.op === "triangle"
        ? triPoints(o.center[0], o.center[1], o.w, o.h)
        : starPoints(o.center[0], o.center[1], o.r);
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.closePath();
      if (o.fill) ctx.fill();
      else ctx.stroke();
    } else if (o.op === "arrow") {
      const [h1, h2] = arrowHead(o.from, o.to, o.strokeWidth);
      ctx.moveTo(o.from[0], o.from[1]);
      ctx.lineTo(o.to[0], o.to[1]);
      ctx.moveTo(h1[0], h1[1]);
      ctx.lineTo(o.to[0], o.to[1]);
      ctx.lineTo(h2[0], h2[1]);
      ctx.stroke();
    } else {
      ctx.font = `${o.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.content, o.center[0], o.center[1]);
    }
  }

  // painting all ops plus the live draft on canvas
  function paint() {
    const c = canvasRef.current;
    if (!c || mode !== "brush-ops") return;
    const ctx = c.getContext("2d")!;
    const cssW = c.clientWidth || 1;
    const cssH = c.clientHeight || 1;
    const g = viewGeom(cssW, cssH);
    const dprX = c.width / cssW;
    const dprY = c.height / cssH;
    // mapping board units straight to screen through zoom, pan and centering
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dprX * g.s, 0, 0, dprY * g.s, dprX * (-(view.cx - g.vw / 2) * g.s + g.ox), dprY * (-(view.cy - g.vh / 2) * g.s + g.oy));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // clipping to the paper so wide brushes and glow never bleed past the edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    ctx.clip();
    // photo first so strokes trace over it
    if (bg && bgImg.current?.src === bg.src) {
      const f = fitBg(bg.w, bg.h, size.w, size.h);
      ctx.drawImage(bgImg.current.el, f.x, f.y, f.w, f.h);
    }
    // layers decide paint order and visibility
    for (const o of orderedVisibleOps(ops, layers)) strokeOp(ctx, o);
    // draft on top with dashes so it reads as preview
    if (draft) {
      const dop = draftToOp(draft);
      if (dop) {
        ctx.save();
        ctx.setLineDash([10, 7]);
        strokeOp(ctx, dop);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  // turning a draft into a real op for preview
  function draftToOp(d: Draft): DrawOp | null {
    const w = width;
    // brush tip rides along, default pen stays a clean op
    const tip = brushKind === "pen" ? {} : { brush: brushKind };
    if (d.kind === "free") {
      if (d.points.length < 2) return null;
      const t: Tool = tool === "eraser" ? "eraser" : "brush";
      return { op: "polyline", tool: t, color, strokeWidth: t === "eraser" ? w * 3 : w, points: d.points, ...(t === "brush" ? tip : {}) };
    }
    const dx = d.to[0] - d.from[0];
    const dy = d.to[1] - d.from[1];
    if (Math.hypot(dx, dy) < 4) return null;
    if (d.kind === "line") {
      return { op: "line", tool: "brush", color, strokeWidth: w, from: d.from, to: d.to, ...tip };
    }
    if (d.kind === "arrow") {
      return { op: "arrow", tool: "brush", color, strokeWidth: w, from: d.from, to: d.to, ...tip };
    }
    const cx = (d.from[0] + d.to[0]) / 2;
    const cy = (d.from[1] + d.to[1]) / 2;
    const bw = Math.abs(dx);
    const bh = Math.abs(dy);
    if (d.kind === "rect") {
      return { op: "rect", tool: "brush", color, strokeWidth: w, fill, center: [cx, cy], w: bw, h: bh, ...tip };
    }
    if (d.kind === "ellipse") {
      return { op: "ellipse", tool: "brush", color, strokeWidth: w, fill, center: [cx, cy], rx: bw / 2, ry: bh / 2, ...tip };
    }
    if (d.kind === "triangle") {
      return { op: "triangle", tool: "brush", color, strokeWidth: w, fill, center: [cx, cy], w: bw, h: bh, ...tip };
    }
    if (d.kind === "star") {
      return { op: "star", tool: "brush", color, strokeWidth: w, fill, center: [cx, cy], r: Math.hypot(dx, dy) / 2, ...tip };
    }
    return { op: "circle", tool: "brush", color, strokeWidth: w, fill, center: [cx, cy], r: Math.hypot(dx, dy) / 2, ...tip };
  }

  // loading drawing once by id, localStorage read needs effect on client
  useEffect(() => {
    const st = loadSettings();
    applySettings(st);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeterModel(st.model);
    setMeterProvider(st.provider);
    setVoiceOut(st.voiceOut);
    setHasKey(Boolean(st.apiKey.trim()));
    fetch("/api/draw")
      .then((r) => r.json())
      .then((d) => {
        if (d?.hasServerKey) setHasKey(true);
      })
      .catch(() => {
        // status check failed, settings key still counts
      });
    const refreshMeter = () => {
      const cur = loadSettings();
      setMeterModel(cur.model);
      setMeterProvider(cur.provider);
      setVoiceOut(cur.voiceOut);
      setHasKey(Boolean(cur.apiKey.trim()));
      fetch("/api/draw")
        .then((r) => r.json())
        .then((d) => {
          if (d?.hasServerKey) setHasKey(true);
        })
        .catch(() => {
          // ignoring
        });
    };
    window.addEventListener("focus", refreshMeter);
    const d = getDrawing(id);
    if (d) {
      setOps(d.ops);
      setMode(d.mode);
      setTitle(d.title);
      setMsgs(d.chat);
      setIntent(d.intent);
      setLayers(d.layers);
      setActiveLayerId(d.layers[0]?.id || "");
      setBg(d.bg || null);
      const sz = d.size && Number.isFinite(d.size.w) && Number.isFinite(d.size.h) ? d.size : { w: BOARD_SIZE, h: BOARD_SIZE };
      setSize(sz);
      // starting centered on the paper, not always 500,500
      setView({ s: 1, cx: Math.round(sz.w / 2), cy: Math.round(sz.h / 2) });
    }
    setReady(true);
    return () => window.removeEventListener("focus", refreshMeter);
  }, [id]);

  // saving quietly on every change, chat session included
  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/purity -- timestamp for ordering saves
    saveDrawing({ id, title, mode, size, ops, layers, bg: bg || undefined, chat: msgs, intent, updatedAt: Date.now() });
  }, [ops, layers, size, bg, mode, title, msgs, intent, id, ready]);

  // fitting canvas to screen with sharp retina backing
  // reruns when the canvas actually mounts (after loading) or the mode flips
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    const fix = () => {
      const c = canvasRef.current;
      const box = boxRef.current;
      if (!c || !box) return;
      const r = box.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      // resizing clears the canvas, bumping a repaint
      setSizeTick((t) => t + 1);
      setCssSize((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height }
      );
    };
    fix();
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
  }, [ready, mode]);

  // repainting when ops, layers, draft, view, mode or canvas size change
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, layers, mode, draft, view, sizeTick]);

  // loading the photo element when src changes, repainting on arrival
  useEffect(() => {
    if (!bg?.src) {
      bgImg.current = null;
      return;
    }
    if (bgImg.current?.src === bg.src) return;
    const el = new Image();
    el.onload = () => {
      bgImg.current = { src: (bg as BgImage).src, el };
      paint();
    };
    el.src = bg.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg?.src]);

  // scroll to zoom, anchored at the cursor
  // waits for ready: the board box only mounts after loading
  useEffect(() => {
    if (!ready) return;
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const vw = size.w / v.s;
        const vh = size.h / v.s;
        const sc = Math.min(r.width / vw, r.height / vh);
        const ox = (r.width - sc * vw) / 2;
        const oy = (r.height - sc * vh) / 2;
        // board point under the cursor stays put
        const bx = (px - ox) / sc + (v.cx - vw / 2);
        const by = (py - oy) / sc + (v.cy - vh / 2);
        const ns = Math.min(8, Math.max(0.5, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const nw = size.w / ns;
        const nh = size.h / ns;
        const nsc = Math.min(r.width / nw, r.height / nh);
        const nox = (r.width - nsc * nw) / 2;
        const noy = (r.height - nsc * nh) / 2;
        return clampView({
          s: ns,
          cx: bx - (px - nox) / nsc + nw / 2,
          cy: by - (py - noy) / nsc + nh / 2,
        });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // resubscribing once the drawing (and its size) has loaded
    // clampView omitted: rebuilt every render from the same size, always fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size]);

  // space bar pans like in design tools, ignored while typing
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === "Space" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
        e.preventDefault();
        spaceDown.current = true;
      }
    };
    const up = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // zoom helpers shared by buttons, minimap and keyboard
  function zoomIn() {
    setView((v) => clampView({ ...v, s: v.s * 1.25 }));
  }
  function zoomOut() {
    setView((v) => clampView({ ...v, s: v.s / 1.25 }));
  }
  function resetView() {
    setView({ s: 1, cx: Math.round(size.w / 2), cy: Math.round(size.h / 2) });
  }

  // plus/minus zooms, zero resets, ignored while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // snapshot before an ai edit replaces the canvas, one-tap restore
  const [editBackup, setEditBackup] = useState<DrawOp[] | null>(null);

  // clearing redo when new stroke comes
  function pushOp(o: DrawOp) {
    const key = o.key || crypto.randomUUID();
    setOps((p) => [...p, { ...o, key }]);
    // new strokes land on the active layer
    const aid = activeRef.current;
    setLayers((prev) => {
      if (!prev.length) return [{ id: aid || crypto.randomUUID(), name: "Layer 1", visible: true, keys: [key] }];
      const at = Math.max(0, prev.findIndex((l) => l.id === aid));
      return prev.map((l, i) => (i === at ? { ...l, keys: [...l.keys, key] } : l));
    });
    setRedoStack([]);
    // fresh strokes void the edit safety net below
    setEditBackup(null);
  }

  // merging a remote canvas: appends win, shrinks are followed
  function applyRemoteDoc(rOps: DrawOp[], rLayers: Layer[]) {
    setOps((prev) => {
      if (rOps.length < prev.length) return rOps;
      const have = new Set(prev.map((o) => o.key));
      const add = rOps.filter((o) => o.key && !have.has(o.key));
      return add.length ? [...prev, ...add] : prev;
    });
    setLayers((prev) => {
      const out = [...prev];
      for (const rl of rLayers) {
        const i = out.findIndex((l) => l.id === rl.id);
        if (i === -1) {
          out.push(rl);
        } else {
          const keys = [...out[i].keys];
          for (const k of rl.keys) if (!keys.includes(k)) keys.push(k);
          out[i] = { ...out[i], keys, visible: rl.visible };
        }
      }
      return out;
    });
  }

  // undoing the last ai edit
  function undoEdit() {
    if (!editBackup) return;
    setOps(editBackup);
    setRedoStack([]);
    setEditBackup(null);
  }

  // strokes actually painted, in layer order
  const shownOps = orderedVisibleOps(ops, layers);
  // fitted photo rect, shared by canvas, svg and minimap
  const bgFit = bg ? fitBg(bg.w, bg.h, size.w, size.h) : null;

  // per-layer stroke counts for the panel
  const layerCounts = (() => {
    const counts: Record<string, number> = {};
    for (const o of ops) {
      if (!o.key) continue;
      const l = layers.find((x) => x.keys.includes(o.key as string));
      if (l) counts[l.id] = (counts[l.id] || 0) + 1;
    }
    return counts;
  })();

  function toggleLayer(id: string) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }

  function renameLayer(id: string, name: string) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }

  function addLayer() {
    const l = blankLayer(`Layer ${layers.length + 1}`);
    setLayers((prev) => [...prev, l]);
    setActiveLayerId(l.id);
  }

  function removeLayer(id: string) {
    if (layers.length <= 1) return;
    const gone = layers.find((l) => l.id === id);
    const goneKeys = new Set(gone ? gone.keys : []);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setOps((prev) => prev.filter((o) => !o.key || !goneKeys.has(o.key)));
    setRedoStack([]);
    setEditBackup(null);
    setFrameLabel("layer deleted");
    if (activeRef.current === id) {
      const rest = layers.filter((l) => l.id !== id);
      setActiveLayerId(rest[0]?.id || "");
    }
  }

  function moveLayer(id: string, dir: -1 | 1) {
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function onDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    // locked while doodle works, panning still allowed
    const wantPan = tool === "hand" || spaceDown.current || e.button === 1;
    if (busy && !wantPan) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // hand tool, space bar, or middle click pans instead of drawing
    if (wantPan) {
      if (e.button === 1) e.preventDefault();
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const [p] = eventPoints(e);
    // text tool just drops a text box where you tap
    if (tool === "text") {
      setTextAt(p);
      setTextValue("");
      return;
    }
    // dropper samples the canvas color under the tap
    if (tool === "dropper") {
      pickColor(e);
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      setDraft({ kind: "free", points: [p] });
    } else if (
      tool === "line" || tool === "rect" || tool === "circle" || tool === "ellipse" ||
      tool === "triangle" || tool === "star" || tool === "arrow"
    ) {
      setDraft({ kind: tool, from: p, to: p });
    }
  }

  function onMove(e: React.PointerEvent) {
    // live readout follows the pointer even when not drawing
    if (!panStart.current) {
      const box = boxRef.current;
      if (box) {
        const r = box.getBoundingClientRect();
        const p = toBoardPx(e.clientX, e.clientY, r);
        setCursor((prev) => (prev && prev[0] === p[0] && prev[1] === p[1] ? prev : p));
      }
    }
    // panning moves the view, not the drawing
    if (panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      panStart.current = { x: e.clientX, y: e.clientY };
      const box = boxRef.current!;
      const r = box.getBoundingClientRect();
      setView((v) => {
        const vw = size.w / v.s;
        const vh = size.h / v.s;
        const s = Math.min(r.width / vw, r.height / vh);
        return clampView({ s: v.s, cx: v.cx - dx / s, cy: v.cy - dy / s });
      });
      return;
    }
    setDraft((prev) => {
      if (!prev) return prev;
      const pts = eventPoints(e);
      if (prev.kind === "free") {
        // skipping near-duplicate points keeps curves smooth and ops small
        const next = [...prev.points];
        for (const p of pts) {
          const last = next[next.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 3) next.push(p);
        }
        return { kind: "free", points: next };
      }
      return { ...prev, to: pts[pts.length - 1] };
    });
  }

  function onUp() {
    panStart.current = null;
    if (!draft) return;
    // single tap with brush leaves a dot
    if (draft.kind === "free" && draft.points.length === 1) {
      const [p] = draft.points;
      const t: Tool = tool === "eraser" ? "eraser" : "brush";
      pushOp({ op: "line", tool: t, color, strokeWidth: t === "eraser" ? width * 3 : width, from: p, to: p, ...(t === "brush" && brushKind !== "pen" ? { brush: brushKind } : {}) });
    } else {
      const op = draftToOp(draft);
      if (op) pushOp(op);
    }
    setFrameLabel("you drew");
    setDraft(null);
  }

  // committing the text box
  function commitText() {
    if (textAt && textValue.trim()) {
      pushOp({
        op: "text",
        tool: "brush",
        color,
        center: textAt,
        size: Math.min(120, Math.max(16, width * 8)),
        content: textValue.trim().slice(0, 120),
      });
      setFrameLabel("you wrote");
    }
    setTextAt(null);
    setTextValue("");
  }

  // sampling the canvas color under the pointer, sketch mode only
  function pickColor(e: React.PointerEvent) {
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!c || !box || mode !== "brush-ops") return;
    const r = box.getBoundingClientRect();
    const x = Math.min(c.width - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * c.width)));
    const y = Math.min(c.height - 1, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * c.height)));
    try {
      const d = c.getContext("2d")!.getImageData(x, y, 1, 1).data;
      if (d[3] === 0) return;
      const hex = (v: number) => v.toString(16).padStart(2, "0");
      setColor(`#${hex(d[0])}${hex(d[1])}${hex(d[2])}`);
      setTool("brush");
    } catch {
      // unreadable pixels, keeping the current color
    }
  }

  // importing a photo to trace over, downscaled before saving
  async function importPhoto(file: File | undefined) {    if (!file || !file.type.startsWith("image/")) return;
    try {
      setBg(await fileToBg(file));
    } catch {
      // unreadable file, keeping the old background
    }
  }

  function undo() {
    // removing last stroke, keeping it for redo
    if (ops.length === 0) return;
    const last = ops[ops.length - 1];
    setOps(ops.slice(0, -1));
    setRedoStack([...redoStack, last]);
    setFrameLabel("undone");
  }

  function redo() {
    // bringing back what we removed
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setOps([...ops, last]);
    setRedoStack(redoStack.slice(0, -1));
    setFrameLabel("redone");
  }

  // asking AI, plan describes while build draws
  async function askAi() {
    if (!prompt.trim() || busy) return;
    // stopping dictation so it never talks over the send
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      setVoiceOn(false);
    }
    const q = prompt.trim();
    setPrompt("");
    sendText(q);
  }

  // shared sender for chat input and mcq answers
  // request handles for stopping mid-flight
  const abortRef = useRef<AbortController | null>(null);
  const opTimers = useRef<number[]>([]);
  const stageTimers = useRef<number[]>([]);
  // staged agent status, cleared on finish
  const [busyStage, setBusyStage] = useState("");
  // edit timeline: snapshots of ops plus layers, session only
  type Frame = { id: number; at: number; label: string; ops: DrawOp[]; layers: Layer[] };
  const [frames, setFrames] = useState<Frame[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [frameLabel, setFrameLabel] = useState("opened");  const frameTimer = useRef(0);
  // live mirrors for the debounced snapshotter
  const opsRef = useRef<DrawOp[]>([]);
  const layersRef = useRef<Layer[]>([]);
  useEffect(() => {
    opsRef.current = ops;
    layersRef.current = layers;
  }, [ops, layers]);

  // snapshotting a frame when edits settle, capped at 24
  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(frameTimer.current);
    frameTimer.current = window.setTimeout(() => {
      const o = opsRef.current;
      const l = layersRef.current;
      const at = Date.now();
      setFrames((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.ops === o) return prev;
        return [...prev, { id: (last?.id || 0) + 1, at, label: frameLabel, ops: o, layers: l }].slice(-24);
      });
    }, 2500);
    return () => window.clearTimeout(frameTimer.current);
  }, [ops, layers, ready, frameLabel]);

  // restoring a frame onto the board, old canvas kept under undo edit
  function restoreFrame(f: Frame) {
    if (busy) return;
    setEditBackup(ops);
    setOps(f.ops);
    setLayers(f.layers);
    setRedoStack([]);
    setFrameLabel("restored frame");
  }
  // ghost cursor showing where doodle is drawing, board coords
  const [aiCursor, setAiCursor] = useState<{ x: number; y: number } | null>(null);

  // first point of an op, where the cursor jumps to
  function opAnchor(o: DrawOp): [number, number] {
    if (o.op === "line" || o.op === "bezier" || o.op === "arrow") return o.from;
    if (o.op === "polyline") return o.points[0] || [Math.round(size.w / 2), Math.round(size.h / 2)];
    if (o.op === "circle" || o.op === "rect" || o.op === "text" || o.op === "ellipse" || o.op === "triangle" || o.op === "star") return o.center;
    return [Math.round(size.w / 2), Math.round(size.h / 2)];
  }
  // chat scroll container for autoscroll
  const scrollRef = useRef<HTMLDivElement>(null);
  // which message was just copied
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // keeping the latest turn in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el && chatOpen) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, busyStage, chatOpen]);

    // clearing all pending timers
  function clearTimers() {
    opTimers.current.forEach((t) => clearTimeout(t));
    stageTimers.current.forEach((t) => clearTimeout(t));
    opTimers.current = [];
    stageTimers.current = [];
  }

  // clearing only stage labels, stroke timers keep running to finish drawing
  function clearStages() {
    stageTimers.current.forEach((t) => clearTimeout(t));
    stageTimers.current = [];
  }

  // reading the latest assistant reply aloud when enabled
  useEffect(() => {
    if (!voiceOut) return;
    const last = msgs[msgs.length - 1];
    if (!last || last.me || !last.text) return;
    if (/^(added \d+|nothing came back|no plan came back|stopped|updated)/.test(last.text)) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const clean = last.text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[*_`#>\-]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      if (!clean) return;
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance(clean));
    } catch {
      // no speech engine, staying quiet
    }
  }, [msgs, voiceOut]);

  // toggling read-aloud, persisted in settings
  function toggleVoiceOut() {
    const st = loadSettings();
    st.voiceOut = !st.voiceOut;
    saveSettings(st);
    setVoiceOut(st.voiceOut);
    if (!st.voiceOut) {
      try {
        speechSynthesis.cancel();
      } catch {
        // ignoring
      }
    }
  }
  // stopping generation: aborting the call and dropping queued strokes
  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    setAiCursor(null);
    try {
      speechSynthesis.cancel();
    } catch {
      // no speech engine, ignoring
    }
    setBusy(false);
    setBusyStage("");
    setMsgs((m) => [...m, { me: false, text: "stopped — ask again or retry" }]);
  }

  // retrying the last thing the user said
  function retry() {
    if (busy) return;
    const last = [...msgs].reverse().find((m) => m.me);
    if (last) sendText(last.text);
  }

  // toggling mic dictation straight into the chat box
  function toggleVoice() {
    if (voiceOn) {
      recRef.current?.stop();
      recRef.current = null;
      setVoiceOn(false);
      return;
    }
    const w = window as unknown as { SpeechRecognition?: SpeechTalkerCtor; webkitSpeechRecognition?: SpeechTalkerCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      setPrompt(text.trim());
    };
    rec.onerror = () => {
      recRef.current = null;
      setVoiceOn(false);
    };
    rec.onend = () => {
      recRef.current = null;
      setVoiceOn(false);
    };
    try {
      rec.start();
      recRef.current = rec;
      setVoiceOn(true);
    } catch {
      // mic blocked, staying quiet
    }
  }

  // copying an assistant reply
  function copyMsg(i: number, text: string) {
    const done = () => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
    else done();
  }

  async function sendText(q: string, asIntent?: Intent) {
    if (busy) return;
    // mcq answers always travel as plan, even after switching to build
    const useIntent = asIntent || intent;
    const nextMsgs: ChatMsg[] = [...msgs, { me: true, text: q }];
    setMsgs(nextMsgs);
    setBusy(true);
    // staged status so waiting never looks frozen
    setBusyStage("understanding…");
    stageTimers.current.push(window.setTimeout(() => setBusyStage(useIntent === "plan" ? "planning questions…" : "sketching strokes…"), 1500));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // reading provider key from settings, so board uses what user saved
      const raw = localStorage.getItem("ai-board-settings-v1");
      const cfg = raw ? JSON.parse(raw) : {};
      const res = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: q,
          mode,
          intent: useIntent,
          size: { w: size.w, h: size.h },
          // trimmed canvas so the ai can edit what exists
          canvas: ops.slice(-40).map((o) =>
            o.op === "svg"
              ? { ...o, markup: o.markup.slice(0, 500) }
              : o.op === "polyline"
                ? { ...o, points: o.points.slice(0, 60) }
                : o
          ),
          history: nextMsgs.slice(-10).map((m) => ({
            role: m.me ? "user" : "assistant",
            content: m.text,
          })),
          provider: cfg.provider || "nvidia",
          apiKey: cfg.apiKey || "",
          model: cfg.model || "",
          baseUrl: cfg.baseUrl || "",
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      // provenance tag so the chat shows real data, not mystery replies
      const via = `${data.source || cfg.provider || "mock"} / ${String(cfg.model || meterModel || "?").split("/").pop()}`;
      if (useIntent === "plan") {
        const questions = Array.isArray(data.questions)
          ? (data.questions as PlanQuestion[])
          : [];
        setMsgs((m) => [
          ...m,
          { me: false, text: String(data.plan || "no plan came back, try again"), questions, done: false, via, kind: "plan" as const },
        ]);
      } else {
        applyBuildResult(data as DrawResult, via);
      }
    } catch (e) {
      // aborted by stop button, staying quiet
      if (e instanceof DOMException && e.name === "AbortError") {
        setBusy(false);
        setBusyStage("");
        return;
      }
      setMsgs((m) => [...m, { me: false, text: "something went wrong, try again" }]);
    }
    clearStages();
    abortRef.current = null;
    setBusy(false);
    setBusyStage("");
  }

  // loose shape of /api/draw build replies
  type DrawResult = {
    ops?: unknown;
    svg?: unknown;
    say?: unknown;
    replace?: unknown;
    source?: unknown;
  };

  // shared applier for build and vision-refine replies
  function applyBuildResult(data: DrawResult, via: string) {
    const newOps = (data.ops || []) as DrawOp[];
    const say = typeof data.say === "string" ? data.say.trim().slice(0, 500) : "";
    // honest label when the mock answered instead of a real model
    const demo = data.source === "mock" ? " (demo mode — add an API key for real drawings)" : "";
    // spoken reply for greetings and questions
    if (say) setMsgs((m) => [...m, { me: false, text: say, via }]);
        // svg mode injects raw markup straight onto the screen
        const rawSvg = typeof data.svg === "string" ? data.svg : "";
        if (mode === "svg" && rawSvg.trim()) {
          const clean = sanitizeSvgInner(rawSvg);
          if (clean) {
            // edit replaces old artwork, otherwise it appends
            if (data.replace === true) {
              const art: DrawOp = { op: "svg", tool: "brush", markup: clean, key: crypto.randomUUID() };
              setEditBackup(ops);
              // dropping old ai artwork, hand strokes stay, layers cleaned
              const kept = ops.filter((o) => o.op !== "svg");
              const keepKeys = new Set(kept.map((o) => o.key));
              const base = layers.length ? layers : [blankLayer("Layer 1")];
              const at = Math.max(0, base.findIndex((l) => l.id === activeRef.current));
              setLayers(
                base.map((l, i) => ({
                  ...l,
                  keys: [...l.keys.filter((k) => keepKeys.has(k)), ...(i === at ? [art.key as string] : [])],
                }))
              );
              setOps([...kept, art]);
              setRedoStack([]);
              setFrameLabel("Doodle edited");
              // flashing the cursor where the new artwork lands
              setAiCursor({ x: Math.round(size.w / 2), y: Math.round(size.h / 2) });
              opTimers.current.push(window.setTimeout(() => setAiCursor(null), 800));
              setMsgs((m) => [...m, { me: false, text: `updated the artwork${demo}`, via }]);
            } else {
              pushOp({ op: "svg", tool: "brush", markup: clean });
              setFrameLabel("Doodle drew");
              setAiCursor({ x: Math.round(size.w / 2), y: Math.round(size.h / 2) });
              opTimers.current.push(window.setTimeout(() => setAiCursor(null), 800));
              setMsgs((m) => [...m, { me: false, text: `added 1 artwork${demo}`, via }]);
            }
          } else if (!newOps.length && !say) {
            setMsgs((m) => [...m, { me: false, text: "nothing came back, try rephrasing", via }]);
          }
        } else {
          // edit replaces the whole canvas, otherwise strokes append one by one
          if (data.replace === true && newOps.length) {
            const keyed = newOps.map((o) => ({ ...o, key: o.key || crypto.randomUUID() }));
            const newKeys = new Set(keyed.map((o) => o.key));
            setEditBackup(ops);
            // echoed keys keep their layers, brand-new strokes join the active one
            const base = layers.length ? layers : [blankLayer("Layer 1")];
            const hadKeys = new Set(base.flatMap((l) => l.keys));
            const fresh = [...newKeys].filter((k) => !hadKeys.has(k as string)) as string[];
            const at = Math.max(0, base.findIndex((l) => l.id === activeRef.current));
            setLayers(
              base.map((l, i) => ({
                ...l,
                keys: [...l.keys.filter((k) => newKeys.has(k)), ...(i === at ? fresh : [])],
              }))
            );
            setOps(keyed);
            setRedoStack([]);
            setFrameLabel("Doodle edited");
            // flashing the cursor over the edited area
            const [ex, ey] = opAnchor(keyed[0]);
            setAiCursor({ x: ex, y: ey });
            opTimers.current.push(window.setTimeout(() => setAiCursor(null), 900));
            setMsgs((m) => [...m, { me: false, text: `updated with ${newOps.length} strokes${demo}`, via }]);
          } else {
            // cursor rides along while strokes land one by one
            newOps.forEach((o, i) => {
              opTimers.current.push(
                window.setTimeout(() => {
                  const [ax, ay] = opAnchor(o);
                  setAiCursor({ x: ax, y: ay });
                  pushOp(o);
                }, i * 250)
              );
            });
            if (newOps.length) {
              opTimers.current.push(window.setTimeout(() => setAiCursor(null), newOps.length * 250 + 600));
              setFrameLabel("Doodle drew");
              setMsgs((m) => [...m, { me: false, text: `added ${newOps.length} strokes${demo}`, via }]);
            } else if (!say) setMsgs((m) => [...m, { me: false, text: "nothing came back, try rephrasing", via }]);
          }
        }
  }

  // sending mcq picks back as one answer, locking that question set
  function submitAnswers(msgIndex: number, summary: string) {
    if (!summary.trim() || busy) return;
    setMsgs((m) => m.map((msg, i) => (i === msgIndex ? { ...msg, done: true } : msg)));
    setTimeout(() => sendText(summary, "plan"), 0);
  }

  // one tap from an agreed plan straight into drawing it
  function buildThisPlan(planText: string) {
    if (busy) return;
    setIntent("build");
    setTimeout(() => sendText(`Draw this. Agreed plan: ${planText.slice(0, 800)}`, "build"), 0);
  }

  // screenshotting the board for the vision loop, small jpeg
  async function captureBoard(): Promise<string | null> {
    try {
      if (mode === "svg") {
        const c = await rasterize(
          opsToSvg({ id, title, mode, size, ops, layers, bg: bg || undefined, chat: [], intent: "build", updatedAt: 0 }),
          768
        );
        return c.toDataURL("image/jpeg", 0.8);
      }
      const src = canvasRef.current;
      if (!src) return null;
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src.toDataURL("image/png");
      });
      const k = Math.min(1, 768 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.8);
    } catch {
      return null;
    }
  }

  // vision refine: model looks at the board and redraws it better
  async function refineVision() {
    if (busy) return;
    setMsgs((m) => [...m, { me: true, text: "Refine this drawing" }]);
    setBusy(true);
    setBusyStage("capturing…");
    const shot = await captureBoard();
    if (!shot) {
      setBusy(false);
      setBusyStage("");
      setMsgs((m) => [...m, { me: false, text: "could not capture the board, try again" }]);
      return;
    }
    const lastReq = [...msgs].reverse().find((m) => m.me)?.text || "Improve this drawing";
    setBusyStage("looking…");
    stageTimers.current.push(window.setTimeout(() => setBusyStage("redrawing…"), 4000));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const raw = localStorage.getItem("ai-board-settings-v1");
      const cfg = raw ? JSON.parse(raw) : {};
      const res = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: lastReq.slice(0, 500),
          mode,
          intent: "refine",
          size: { w: size.w, h: size.h },
          image: shot,
          canvas: ops.slice(-40).map((o) =>
            o.op === "svg"
              ? { ...o, markup: o.markup.slice(0, 500) }
              : o.op === "polyline"
                ? { ...o, points: o.points.slice(0, 60) }
                : o
          ),
          history: msgs.slice(-10).map((m) => ({ role: m.me ? "user" : "assistant", content: m.text })),
          provider: cfg.provider || "nvidia",
          apiKey: cfg.apiKey || "",
          model: cfg.model || "",
          baseUrl: cfg.baseUrl || "",
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      const via = `${data.source || cfg.provider || "mock"} / vision`;
      applyBuildResult(data, via);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setMsgs((m) => [...m, { me: false, text: "something went wrong, try again" }]);
      }
    }
    clearStages();
    abortRef.current = null;
    setBusy(false);
    setBusyStage("");
  }

  // short model name for the picker button, state only so ssr matches
  function shortModel(): string {
    if (!meterModel) return "pick model";
    const parts = meterModel.split("/");
    return parts[parts.length - 1] || meterModel;
  }

  // loading the online models list for the saved provider and key
  async function toggleModelPicker() {
    if (modelOpen) {
      setModelOpen(false);
      return;
    }
    setModelOpen(true);
    setModelFilter("");
    setModelErr("");
    const cfg = loadSettings();
    if (!cfg.apiKey.trim()) {
      setModelErr("add an api key in settings first");
      setModelList([]);
      return;
    }
    setModelLoading(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: cfg.provider, apiKey: cfg.apiKey.trim(), baseUrl: cfg.baseUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModelErr(String(data.error || "could not load models"));
        setModelList([]);
      } else {
        setModelList((data.models || []) as string[]);
      }
    } catch {
      setModelErr("network error, try again");
      setModelList([]);
    }
    setModelLoading(false);
  }

  // switching model right from the chat box
  function pickModel(m: string) {
    const st = loadSettings();
    st.model = m;
    saveSettings(st);
    setMeterModel(m);
    setMeterProvider(st.provider);
    setModelOpen(false);
  }

  // context meter from the restored session
  const usedTokens = estimateTokens(msgs.map((m) => m.text).join("\n"));
  const haveTokens = contextLimit(meterModel, meterProvider);
  const ctxPct = Math.min(100, Math.round((usedTokens / haveTokens) * 100));

  // one svg node per op, used by board and draft overlay
  function opNode(o: DrawOp, i: number | string, dashed = false) {
    if (o.op === "svg")
      return <g key={i} dangerouslySetInnerHTML={{ __html: sanitizeSvgInner(o.markup) }} />;
    const col = o.tool === "eraser" ? "white" : o.color;
    const dash = dashed ? { strokeDasharray: "12 8" } : {};
    // one node per brush pass so glow styles layer up
    const passes = brushPasses(o);
    const one = (wMul: number, alpha: number, k: number | string) => {
      const w = o.op === "text" ? 0 : o.strokeWidth * wMul;
      const op = { opacity: alpha };
      if (o.op === "line")
        return <line key={k} x1={o.from[0]} y1={o.from[1]} x2={o.to[0]} y2={o.to[1]} stroke={col} strokeWidth={w} strokeLinecap="round" {...op} {...dash} />;
      if (o.op === "polyline")
        return <polyline key={k} points={o.points.map((p) => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...op} {...dash} />;
      if (o.op === "bezier")
        return <path key={k} d={`M${o.from[0]} ${o.from[1]} C${o.cp1[0]} ${o.cp1[1]} ${o.cp2[0]} ${o.cp2[1]} ${o.to[0]} ${o.to[1]}`} fill="none" stroke={col} strokeWidth={w} {...op} {...dash} />;
      if (o.op === "circle")
        return <circle key={k} cx={o.center[0]} cy={o.center[1]} r={o.r} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} {...dash} />;
      if (o.op === "rect")
        return <rect key={k} x={o.center[0] - o.w / 2} y={o.center[1] - o.h / 2} width={o.w} height={o.h} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} {...dash} />;
      if (o.op === "ellipse")
        return <ellipse key={k} cx={o.center[0]} cy={o.center[1]} rx={Math.max(1, o.rx)} ry={Math.max(1, o.ry)} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} {...dash} />;
      if (o.op === "triangle" || o.op === "star") {
        const pts = (o.op === "triangle"
          ? triPoints(o.center[0], o.center[1], o.w, o.h)
          : starPoints(o.center[0], o.center[1], o.r)
        ).map((p) => p.join(",")).join(" ");
        return <polygon key={k} points={pts} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} strokeLinejoin="round" {...op} {...dash} />;
      }
      if (o.op === "arrow") {
        const [h1, h2] = arrowHead(o.from, o.to, o.strokeWidth);
        return (
          <g key={k} stroke={col} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" {...op} {...dash}>
            <line x1={o.from[0]} y1={o.from[1]} x2={o.to[0]} y2={o.to[1]} />
            <path d={`M${h1[0]} ${h1[1]} L${o.to[0]} ${o.to[1]} L${h2[0]} ${h2[1]}`} />
          </g>
        );
      }
      return <text key={k} x={o.center[0]} y={o.center[1]} fontSize={o.size} fill={col} textAnchor="middle" dominantBaseline="central">{o.content}</text>;
    };
    if (passes.length === 1) return one(passes[0].wMul, passes[0].alpha, i);
    return <g key={i}>{passes.map((p, k) => one(p.wMul, p.alpha, `${i}-${k}`))}</g>;
  }

  if (!ready) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">loading...</div>;
  if (ready && ops.length === 0 && !getDrawing(id) && !live) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">drawing not found</p>
        <Link href="/" className="rounded-xl bg-black px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black">
          back to dashboard
        </Link>
      </div>
    );
  }

  // draft preview node for svg mode
  const draftOp = draft ? draftToOp({ ...draft, ...(draft.kind === "free" && draft.points.length < 2 ? { points: [...draft.points, draft.points[0]] } : {}) } as Draft) : null;

  // svg viewport follows zoom and pan
  const vw = size.w / view.s;
  const vh = size.h / view.s;
  const viewBox = `${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`;
  // minimap shows once zoomed or panned away
  const zoomed = view.s > 1.02 || Math.abs(view.cx - size.w / 2) > 1 || Math.abs(view.cy - size.h / 2) > 1;

  // ruler ticks for the visible viewport, projected to screen px
  const ruler = (() => {
    const cw = Math.max(1, cssSize.w);
    const ch = Math.max(1, cssSize.h);
    const g = viewGeom(cw, ch);
    if (!(g.s > 0)) return { top: [] as { x: number; label: string; dim: boolean; minor: boolean }[], side: [] as { y: number; label: string; dim: boolean; minor: boolean }[] };
    const step = niceStep(80 / g.s);
    const minor = step / 5;
    const left = view.cx - g.vw / 2;
    const top = view.cy - g.vh / 2;
    const sx = (bx: number) => (bx - left) * g.s + g.ox;
    const sy = (by: number) => (by - top) * g.s + g.oy;
    const t: { x: number; label: string; dim: boolean; minor: boolean }[] = [];
    for (let bx = Math.floor((left - g.ox / g.s) / minor) * minor; bx <= left + (cw - g.ox) / g.s + minor; bx += minor) {
      const x = sx(Math.round(bx));
      if (x < -20 || x > cw + 20) continue;
      const isMajor = Math.abs(bx / step - Math.round(bx / step)) < 1e-6;
      const bb = Math.round(bx);
      t.push({ x, label: isMajor ? fmtUnit(bb, rulerUnit) : "", dim: bb < 0 || bb > size.w, minor: !isMajor });
    }
    const s: { y: number; label: string; dim: boolean; minor: boolean }[] = [];
    for (let by = Math.floor((top - g.oy / g.s) / minor) * minor; by <= top + (ch - g.oy) / g.s + minor; by += minor) {
      const y = sy(Math.round(by));
      if (y < -20 || y > ch + 20) continue;
      const isMajor = Math.abs(by / step - Math.round(by / step)) < 1e-6;
      const bb = Math.round(by);
      s.push({ y, label: isMajor ? fmtUnit(bb, rulerUnit) : "", dim: bb < 0 || bb > size.h, minor: !isMajor });
    }
    return { top: t, side: s };
  })();

  // moving the view from a minimap tap or drag
  function minimapGo(e: React.PointerEvent) {
    const el = e.currentTarget as SVGSVGElement;
    const r = el.getBoundingClientRect();
    const bx = ((e.clientX - r.left) / r.width) * size.w;
    const by = ((e.clientY - r.top) / r.height) * size.h;
    setView((v) => clampView({ ...v, cx: Math.round(bx), cy: Math.round(by) }));
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#f7f7f5] dark:bg-neutral-950">
      {/* whole screen is board, handlers sit here so drafts work in both modes */}
      <div
        ref={boxRef}
        className={`absolute inset-0 touch-none select-none ${tool === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setCursor(null)}
        onPointerCancel={() => {
          panStart.current = null;
          setDraft(null);
        }}
      >
        {mode === "brush-ops" ? (
          <canvas ref={canvasRef} className="pointer-events-none h-full w-full" />
        ) : (
          <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="pointer-events-none h-full w-full overflow-hidden bg-white">
            {bg && bgFit && <image href={bg.src} x={bgFit.x} y={bgFit.y} width={bgFit.w} height={bgFit.h} preserveAspectRatio="xMidYMid meet" />}
            {shownOps.map((o, i) => opNode(o, i))}
            {draftOp && opNode(draftOp, "draft", true)}
          </svg>
        )}

        {/* floating text box, placed through the current view */}
        {textAt && (
          <input
            autoFocus
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") {
                setTextAt(null);
                setTextValue("");
              }
            }}
            onBlur={commitText}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="type text, Enter to place..."
            aria-label="text to place"
            style={boardPct(textAt[0], textAt[1])}
            className="absolute z-10 w-48 -translate-x-1/2 rounded-lg border border-black bg-white/95 px-2 py-1 text-sm text-black outline-none dark:border-white dark:bg-neutral-900 dark:text-white"
          />
        )}

        {/* doodle working cursor, riding the ai strokes */}
        {aiCursor && (
          <div
            className="pointer-events-none absolute z-30"
            style={boardPct(aiCursor.x, aiCursor.y)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="black" stroke="white" strokeWidth="1.5" className="dark:fill-white dark:stroke-black">
              <path d="M5 3l14 7-6.5 1.5L9 18 5 3z" />
            </svg>
            <span className="ml-4 -mt-1 flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-black px-2 py-0.5 text-[11px] text-white shadow-lg dark:bg-white dark:text-black">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              Doodle
            </span>
          </div>
        )}
      </div>

      {/* rulers: top shows x, right shows y, capped to the paper viewport */}
      <div className="pointer-events-none absolute left-0 right-7 top-0 z-10 h-7 overflow-hidden border-b border-gray-200/70 bg-white/60 backdrop-blur-sm dark:border-neutral-700/70 dark:bg-neutral-900/60" aria-hidden="true">
        {ruler.top.map((t, i) => (
          <div key={i} className="absolute top-0 h-full" style={{ left: t.x }}>
            <div className={`w-px ${t.minor ? "h-1.5 bg-gray-300 dark:bg-neutral-600" : "h-2.5 bg-gray-400 dark:bg-neutral-500"} ${t.dim ? "opacity-40" : ""}`} />
            {!t.minor && (
              <span className={`ml-0.5 block text-[9px] tabular-nums leading-tight text-gray-500 dark:text-gray-400 ${t.dim ? "opacity-40" : ""}`}>{t.label}</span>
            )}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-0 right-0 top-7 z-10 w-7 overflow-hidden border-l border-gray-200/70 bg-white/60 backdrop-blur-sm dark:border-neutral-700/70 dark:bg-neutral-900/60" aria-hidden="true">
        {ruler.side.map((t, i) => (
          <div key={i} className="absolute left-0 w-full" style={{ top: t.y }}>
            <div className={`h-px ${t.minor ? "w-1.5 bg-gray-300 dark:bg-neutral-600" : "w-2.5 bg-gray-400 dark:bg-neutral-500"} ${t.dim ? "opacity-40" : ""}`} />
            {!t.minor && (
              <span className={`mt-0.5 block truncate text-[9px] tabular-nums leading-tight text-gray-500 dark:text-gray-400 ${t.dim ? "opacity-40" : ""}`}>{t.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* live x,y readout with unit picker */}
      <div className="pointer-events-auto absolute bottom-20 left-4 z-20 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 px-2.5 py-1.5 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
        <span className="text-[11px] tabular-nums text-gray-600 dark:text-gray-300" aria-live="off">
          {cursor ? `x ${fmtUnit(cursor[0], rulerUnit)}, y ${fmtUnit(cursor[1], rulerUnit)}` : `— , —`}
        </span>
        <select
          value={rulerUnit}
          onChange={(e) => pickUnit(e.target.value as RulerUnit)}
          title="ruler units"
          aria-label="ruler units"
          className="rounded-lg border border-gray-200 bg-transparent px-1 py-0.5 text-[11px] outline-none dark:border-neutral-700"
        >
          <option value="px">px</option>
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
        </select>
      </div>

      {/* minimap in the corner once zoomed */}
      {zoomed && (
        <div className="absolute right-10 top-20 z-20 w-36 overflow-hidden rounded-2xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="block h-28 w-full cursor-pointer touch-none"
            onPointerDown={(e) => {
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              minimapGo(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons) minimapGo(e);
            }}
          >
            {bg && bgFit && <image href={bg.src} x={bgFit.x} y={bgFit.y} width={bgFit.w} height={bgFit.h} />}
            {shownOps.map((o, i) => opNode(o, `m${i}`))}
            <rect
              x={view.cx - vw / 2}
              y={view.cy - vh / 2}
              width={vw}
              height={vh}
              fill="rgba(0,0,0,0.08)"
              stroke="#888"
              strokeWidth={8}
            />
          </svg>
          <div className="flex items-center justify-between border-t border-gray-100 px-2 py-1 dark:border-neutral-700">
            <button
              onClick={zoomIn}
              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
              aria-label="zoom in"
              title="zoom in (+)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{Math.round(view.s * 100)}%</span>
            <button
              onClick={zoomOut}
              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
              aria-label="zoom out"
              title="zoom out (-)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              onClick={resetView}
              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
              aria-label="reset view"
              title="reset view (ctrl+0)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* always-visible zoom pill, minimap only shows once zoomed */}
      {!zoomed && (
        <div className="absolute bottom-24 right-10 z-20 flex items-center gap-1 rounded-2xl border border-gray-200 bg-white/95 px-1.5 py-1 shadow-xl backdrop-blur sm:bottom-4 dark:border-neutral-700 dark:bg-neutral-900">
          <button
            onClick={zoomOut}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
            aria-label="zoom out"
            title="zoom out (-)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          <span className="min-w-11 text-center text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{Math.round(view.s * 100)}%</span>
          <button
            onClick={zoomIn}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
            aria-label="zoom in"
            title="zoom in (+)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {/* top bar with back and title, mode was picked at create */}
      <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
        <Link href="/" className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800" aria-label="back to dashboard" title="back to dashboard">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5m7-7-7 7 7 7" />
          </svg>
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="drawing title, click to rename"
          title="click to rename"
          placeholder="Untitled"
          className="w-36 rounded bg-transparent px-1 text-sm font-medium outline-none transition-colors hover:bg-gray-50 focus:bg-gray-50 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800 sm:w-40"
        />
        <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:border-neutral-700 dark:text-gray-300">
          {mode === "svg" ? "svg" : "sketch"}
        </span>
        {/* read-only paper badge, size is fixed at create */}
        <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400" title="paper size">
          {sizeLabel(size)}
        </span>
        <button
          onClick={() => setShareOpen(true)}
          title="share this drawing live"
          aria-label="share this drawing live"
          className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2" />
          </svg>
        </button>
        {/* export menu, svg mode offers svg only */}
        <div className="relative">
          <button
            onClick={() => setExportOpen((v) => !v)}
            title="export drawing"
            aria-label="export drawing"
            aria-expanded={exportOpen}
            className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          {exportOpen && (
            <>
              <button aria-label="close export menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setExportOpen(false)} />
              <div className="absolute left-1/2 top-full z-40 mt-2 w-32 -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                {(mode === "svg" ? (["svg"] as const) : (["pdf", "jpg", "png", "svg"] as const)).map((f) => (
                  <button
                    key={f}
                    onClick={() => exportBoard(f)}
                    className="block w-full px-3 py-1.5 text-left text-xs font-medium uppercase transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {live && (
          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            LIVE
          </span>
        )}
      </div>

      {/* share dialog */}
      {shareOpen && (
        <ShareModal
          open
          live={live}
          canLive={canLive}
          link={typeof window !== "undefined" ? `${window.location.origin}/board/${id}?live=1` : ""}
          onStart={() => {
            setLive(true);
            setShareOpen(false);
          }}
          onStop={() => {
            setLive(false);
            setShareOpen(false);
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* live sync: storage snapshots plus presence, only while sharing */}
      {live && (
        <LiveSync ops={ops} layers={layers} applyDoc={applyRemoteDoc} boxRef={boxRef} view={view} size={size} onPeers={setPeers} />
      )}

      {/* remote cursors */}
      {peers.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none absolute z-30"
          style={boardPct(p.x, p.y)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={p.color} stroke="white" strokeWidth="1.5">
            <path d="M5 3l14 7-6.5 1.5L9 18 5 3z" />
          </svg>
          <span
            className="ml-4 -mt-1 block w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] text-white shadow-lg"
            style={{ backgroundColor: p.color }}
          >
            {p.name}
          </span>
        </div>
      ))}

      {/* left chat toggle */}
      <button
        onClick={() => setChatOpen((v) => !v)}
        className="absolute left-4 top-4 z-20 rounded-full border border-gray-200 bg-white p-2 shadow-lg transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        aria-label="toggle AI chat"
        title="toggle AI chat"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {chatOpen && (
        <div className="absolute left-4 top-16 z-20 flex h-[62vh] w-80 max-w-[85vw] flex-col rounded-3xl border border-gray-200 bg-white/95 shadow-2xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
          {/* agent header with avatar and live status */}
          <div className="flex items-center justify-between border-b border-gray-100 p-3 dark:border-neutral-700">
            <div className="flex items-center gap-2">
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                <Logo size={18} />
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-neutral-900 ${busy ? "bg-amber-500" : "bg-green-500"}`} />
              </span>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                  Doodle
                  {!hasKey && !busy && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      demo
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{busy ? busyStage || "working…" : "online"}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => downloadChat(title || "Untitled", msgs)}
                title="export chat as markdown"
                aria-label="export chat as markdown"
                className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
              </button>
              <button
                onClick={toggleVoiceOut}
                title={voiceOut ? "mute replies" : "read replies aloud"}
                aria-label={voiceOut ? "mute replies" : "read replies aloud"}
                aria-pressed={voiceOut}
                className={`rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800 ${voiceOut ? "text-black dark:text-white" : "text-gray-400"}`}
              >
                {voiceOut ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                    <path d="m23 9-6 6M17 9l6 6" />
                  </svg>
                )}
              </button>
              <button onClick={() => setChatOpen(false)} className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800" aria-label="close chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {/* vision refine: screenshot back to the model */}
          <button
            onClick={refineVision}
            disabled={busy}
            title="let the model look at the board and redraw it better"
            className="mx-2 mt-2 flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-1.5 text-xs font-medium transition-colors hover:bg-black hover:text-white disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-white dark:hover:text-black"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
            </svg>
            Refine with vision
          </button>
          {/* plan describes, build draws */}
          <div className="grid grid-cols-2 gap-1 border-b border-gray-100 p-2 dark:border-neutral-700">
            {(["plan", "build"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setIntent(t)}
                disabled={busy}
                aria-pressed={intent === t}
                className={`rounded-lg px-2 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${intent === t ? "bg-black text-white dark:bg-white dark:text-black" : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* context used vs model limit */}
          <div className="border-b border-gray-100 px-3 py-1.5 dark:border-neutral-700" title="session tokens used vs model context">
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>context</span>
              <span className="tabular-nums">{formatTokens(usedTokens)} / {formatTokens(haveTokens)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${ctxPct > 85 ? "bg-red-500" : ctxPct > 60 ? "bg-amber-500" : "bg-green-500"}`}
                style={{ width: `${Math.max(2, ctxPct)}%` }}
              />
            </div>
          </div>
          <div ref={scrollRef} aria-live="polite" className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {msgs.length === 0 && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">tell me something to draw, I will put it on the board</p>
                {!hasKey && (
                  <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    demo mode: add an API key in Settings for real AI drawings
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Draw a house", "Draw a logo", "Who are you?"].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => sendText(chip)}
                      disabled={busy}
                      className="rounded-full border border-gray-200 px-2.5 py-1 text-xs transition-colors hover:bg-black hover:text-white disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-white dark:hover:text-black"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`group ${m.me ? "ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-black px-2.5 py-1.5 text-white dark:bg-white dark:text-black" : "w-fit max-w-[95%] rounded-2xl rounded-bl-md bg-gray-100 px-2.5 py-1.5 dark:bg-neutral-800"}`}>
                {m.me ? (
                  <p className="whitespace-pre-line">{m.text}</p>
                ) : (
                  <ChatText text={m.text} />
                )}
                {!m.me && (
                  <div className="mt-1 flex items-center gap-2">
                    {m.via && (
                      <p className="text-[10px] opacity-60">via {m.via}</p>
                    )}
                    <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => copyMsg(i, m.text)}
                        title={copiedIdx === i ? "copied" : "copy"}
                        className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                      >
                        {copiedIdx === i ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="12" height="12" rx="2" />
                            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                          </svg>
                        )}
                      </button>
                      {/^(something went wrong|nothing came back|stopped|no plan came back)/.test(m.text) && (
                        <button
                          onClick={retry}
                          disabled={busy}
                          title="retry last message"
                          className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-40"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
                          </svg>
                        </button>
                      )}
                    </span>
                  </div>
                )}
                {!m.me && m.questions && m.questions.length > 0 && !m.done && (
                  <McqSet questions={m.questions} onSubmit={(summary) => submitAnswers(i, summary)} />
                )}
                {!m.me && m.kind === "plan" && (
                  <button
                    onClick={() => buildThisPlan(m.text)}
                    disabled={busy}
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-black py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-black"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7M8 7h9v9" />
                    </svg>
                    Build this plan
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex w-fit items-center gap-2 rounded-2xl rounded-bl-md bg-gray-100 px-3 py-2 dark:bg-neutral-800">
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">{busyStage || "working…"}</p>
              </div>
            )}
          </div>
          {/* model picker near the chat slot */}
          <div className="border-t border-gray-100 dark:border-neutral-700">
            <button
              onClick={toggleModelPicker}
              disabled={busy}
              aria-expanded={modelOpen}
              title="change ai model"
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-neutral-800"
            >
              <span className="flex items-center gap-1.5 truncate">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6v6H9zM4 10h-2M4 14h-2M22 10h-2M22 14h-2M10 4V2M14 4V2M10 22v-2M14 22v-2" />
                </svg>
                <span className="truncate font-medium">{shortModel()}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 transition-transform ${modelOpen ? "rotate-180" : ""}`}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {modelOpen && (
              <div className="border-t border-gray-100 dark:border-neutral-700">
                <input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="filter models..."
                  aria-label="filter models"
                  className="w-full border-b border-gray-100 bg-transparent px-3 py-1.5 text-xs outline-none dark:border-neutral-700"
                />
                <div className="max-h-36 overflow-y-auto">
                  {modelLoading && <p className="px-3 py-2 text-xs text-gray-500">loading online models...</p>}
                  {!modelLoading && modelErr && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{modelErr}</p>}
                  {!modelLoading && !modelErr && modelList
                    .filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
                    .map((m) => (
                      <button
                        key={m}
                        onClick={() => pickModel(m)}
                        className={`block w-full truncate px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800 ${m === meterModel ? "font-medium" : ""}`}
                        title={m}
                      >
                        {m}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          {/* one-tap restore after an ai edit */}
          {editBackup && !busy && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5 dark:border-neutral-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">AI edited the canvas</span>
              <button
                onClick={undoEdit}
                className="rounded-lg border border-gray-200 px-2 py-0.5 text-xs transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Undo edit
              </button>
            </div>
          )}
          <div className="flex gap-2 border-t border-gray-100 p-2 dark:border-neutral-700">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askAi()}
              placeholder="draw a house..."
              aria-label="ask AI to draw"
              className="flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-sm outline-none transition-colors focus:border-black dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-white"
            />
            {voiceOk && (
              <button
                onClick={toggleVoice}
                title={voiceOn ? "stop dictation" : "dictate with mic"}
                aria-label={voiceOn ? "stop dictation" : "dictate with mic"}
                aria-pressed={voiceOn}
                className={`shrink-0 rounded-full p-2 transition-colors ${voiceOn ? "bg-red-600 text-white" : "hover:bg-gray-100 dark:hover:bg-neutral-800"}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={voiceOn ? "animate-pulse" : ""}>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
                </svg>
              </button>
            )}
            {busy ? (
              <button onClick={stop} className="rounded-full bg-red-600 px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90" aria-label="stop generating" title="stop generating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button onClick={askAi} disabled={!prompt.trim()} className="rounded-full bg-black px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-black" aria-label="send to AI" title="send to AI">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* layers panel on the right */}
      {layersOpen && (
        <LayersPanel
          layers={layers}
          activeId={activeLayerId}
          counts={layerCounts}
          disabled={busy}
          onSelect={setActiveLayerId}
          onToggle={toggleLayer}
          onRename={renameLayer}
          onAdd={addLayer}
          onRemove={removeLayer}
          onMove={moveLayer}
          onClose={() => setLayersOpen(false)}
        />
      )}

      {/* edit timeline strip above the toolbar */}
      {timelineOpen && (
        <div className="absolute bottom-24 left-1/2 z-20 max-w-[94vw] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {frames.length ? `${frames.length} frames, tap one to restore` : "frames appear as you draw"}
            </span>
            <button
              onClick={() => setTimelineOpen(false)}
              aria-label="close timeline"
              className="rounded-lg p-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex max-w-[90vw] gap-2 overflow-x-auto pb-1">
            {frames.map((f) => (
              <button
                key={f.id}
                onClick={() => restoreFrame(f)}
                disabled={busy}
                title={`restore: ${f.label}`}
                className="w-28 shrink-0 overflow-hidden rounded-xl border border-gray-200 transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 dark:border-neutral-700"
              >
                <svg viewBox={`0 0 ${size.w} ${size.h}`} className="h-16 w-full bg-white dark:bg-neutral-800">
                  {orderedVisibleOps(f.ops, f.layers).slice(0, 30).map((o, i) => opNode(o, `t${f.id}-${i}`))}
                </svg>
                <span className="block truncate px-1.5 py-1 text-left text-[11px]">
                  <span className="font-medium">{f.label}</span>
                  <span className="block text-gray-400">{new Date(f.at).toLocaleTimeString()}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* background photo chip with remove */}
      {bg && (
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/95 py-1.5 pl-1.5 pr-2 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- data-url thumbnail, next/image cannot optimize it */}
          <img src={bg.src} alt="background" className="h-9 w-9 rounded-xl object-cover" />
          <span className="text-xs text-gray-500 dark:text-gray-400">tracing photo</span>
          <button
            onClick={() => setBg(null)}
            title="remove background"
            aria-label="remove background"
            className="rounded-lg p-1 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* bottom floating toolbar, locked while doodle works */}
      <div
        inert={busy}
        className={`absolute bottom-4 left-1/2 z-20 flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur transition-opacity dark:border-neutral-700 dark:bg-neutral-900 ${busy ? "opacity-70" : ""}`}
      >
        {busy && <div title="Doodle is working…" className="absolute inset-0 z-10 cursor-wait rounded-2xl" />}
        <button onClick={() => setTool("brush")} title="brush" className={toolBtn(tool === "brush")} aria-label="brush" aria-pressed={tool === "brush"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
            <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
          </svg>
        </button>
        <button onClick={() => setTool("eraser")} title="eraser" className={toolBtn(tool === "eraser")} aria-label="eraser" aria-pressed={tool === "eraser"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
            <path d="M22 21H7M5 11l9 9" />
          </svg>
        </button>
        <button onClick={() => setTool("hand")} title="pan around (or hold space)" className={toolBtn(tool === "hand")} aria-label="pan" aria-pressed={tool === "hand"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3a1.5 1.5 0 0 1 3 0v5c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3.5L3 13.5c-.8-1.2.7-2.6 1.9-1.7L8 14" />
          </svg>
        </button>
        <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-neutral-700" />
        <button onClick={() => setTool("line")} title="line" className={toolBtn(tool === "line")} aria-label="line" aria-pressed={tool === "line"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 19 19 5" />
          </svg>
        </button>
        <button onClick={() => setTool("rect")} title="rectangle" className={toolBtn(tool === "rect")} aria-label="rectangle" aria-pressed={tool === "rect"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="6" width="16" height="12" rx="1" />
          </svg>
        </button>
        <button onClick={() => setTool("circle")} title="circle" className={toolBtn(tool === "circle")} aria-label="circle" aria-pressed={tool === "circle"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="8" />
          </svg>
        </button>
        <button onClick={() => setTool("text")} title="text" className={toolBtn(tool === "text")} aria-label="text" aria-pressed={tool === "text"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 6V4h14v2M12 4v16m-3 0h6" />
          </svg>
        </button>
        <button onClick={() => setTool("ellipse")} title="ellipse" className={toolBtn(tool === "ellipse")} aria-label="ellipse" aria-pressed={tool === "ellipse"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="8" ry="5.5" />
          </svg>
        </button>
        <button onClick={() => setTool("triangle")} title="triangle" className={toolBtn(tool === "triangle")} aria-label="triangle" aria-pressed={tool === "triangle"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 4 21 20H3z" />
          </svg>
        </button>
        <button onClick={() => setTool("star")} title="star" className={toolBtn(tool === "star")} aria-label="star" aria-pressed={tool === "star"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 2.5l2.9 6.2 6.6.7-4.9 4.5 1.4 6.6-6-3.4-6 3.4 1.4-6.6L2.5 9.4l6.6-.7z" />
          </svg>
        </button>
        <button onClick={() => setTool("arrow")} title="arrow" className={toolBtn(tool === "arrow")} aria-label="arrow" aria-pressed={tool === "arrow"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20 20 4M12 4h8v8" />
          </svg>
        </button>
        <button
          onClick={() => setTool("dropper")}
          disabled={mode !== "brush-ops"}
          title={mode === "brush-ops" ? "pick a color from the canvas" : "eyedropper works in sketch mode"}
          className={toolBtn(tool === "dropper")}
          aria-label="eyedropper"
          aria-pressed={tool === "dropper"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={mode !== "brush-ops" ? "opacity-40" : ""}>
            <path d="m2 22 1-4L16.5 4.5l3 3L6 21l-4 1z" />
            <path d="m14.5 6.5 3 3L21 6l-3-3-3.5 3.5z" />
          </svg>
        </button>
        <button
          onClick={() => setFill((v) => !v)}
          disabled={tool !== "rect" && tool !== "circle" && tool !== "ellipse" && tool !== "triangle" && tool !== "star"}
          title="fill shape"
          className={toolBtn(fill)}
          aria-label="fill shape"
          aria-pressed={fill}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className={tool !== "rect" && tool !== "circle" && tool !== "ellipse" && tool !== "triangle" && tool !== "star" ? "opacity-40" : ""}>
            <path d="m5 11 7-7a2.4 2.4 0 0 1 3.4 0l4.6 4.6a2.4 2.4 0 0 1 0 3.4l-7 7a2 2 0 0 1-1.4.6H7a2 2 0 0 1-2-2v-4.2a2 2 0 0 1 .6-1.4z" />
            <path d="m5 11 7 7" />
          </svg>
        </button>
        <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-neutral-700" />
        <button onClick={() => setLayersOpen((v) => !v)} title="layers" className={toolBtn(layersOpen)} aria-label="layers" aria-pressed={layersOpen} aria-expanded={layersOpen}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12 2 9 5-9 5-9-5 9-5z" />
            <path d="m3 12 9 5 9-5" />
            <path d="m3 17 9 5 9-5" />
          </svg>
        </button>
        <button onClick={() => setTimelineOpen((v) => !v)} title="edit timeline" className={toolBtn(timelineOpen)} aria-label="edit timeline" aria-pressed={timelineOpen} aria-expanded={timelineOpen}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
            <path d="M12 7v5l3 3" />
          </svg>
        </button>
        <button onClick={() => fileRef.current?.click()} title={bg ? "replace background photo" : "add background photo to trace"} className={toolBtn(false)} aria-label="background photo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="upload background photo"
          onChange={(e) => {
            importPhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="color" className="h-8 w-8 cursor-pointer rounded border border-gray-200 dark:border-neutral-700" aria-label="color" />
        <input type="range" min={1} max={40} value={width} onChange={(e) => setWidth(Number(e.target.value))} title="stroke width" className="w-20 accent-black dark:accent-white" aria-label="stroke width" />
        <span className="w-6 text-xs tabular-nums text-gray-600 dark:text-gray-300">{width}</span>
        {/* brush tip picker */}
        <div className="relative">
          <button
            onClick={() => setBrushOpen((v) => !v)}
            title="brush tip"
            aria-label="brush tip"
            aria-expanded={brushOpen}
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs capitalize transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {brushKind}
          </button>
          {brushOpen && (
            <>
              <button aria-label="close brush picker" className="fixed inset-0 z-30 cursor-default" onClick={() => setBrushOpen(false)} />
              <div className="absolute bottom-full right-0 z-40 mb-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                {[
                  { id: "pen", hint: "clean stroke" },
                  { id: "pencil", hint: "thin sketchy" },
                  { id: "marker", hint: "wide translucent" },
                  { id: "neon", hint: "glow" },
                ].map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setBrushKind(b.id);
                      setBrushOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800 ${brushKind === b.id ? "bg-gray-50 dark:bg-neutral-800" : ""}`}
                  >
                    <svg width="52" height="12" viewBox="0 0 52 12" fill="none" stroke="currentColor" strokeLinecap="round">
                      {b.id === "neon" && <path d="M4 6h44" strokeWidth="7" opacity="0.3" />}
                      <path
                        d="M4 6h44"
                        strokeWidth={b.id === "marker" ? 7 : b.id === "pencil" ? 2 : b.id === "neon" ? 3.5 : 3}
                        opacity={b.id === "marker" ? 0.55 : b.id === "pencil" ? 0.9 : 1}
                      />
                    </svg>
                    <span>
                      <span className="block text-xs font-medium capitalize">{b.id}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">{b.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-neutral-700" />
        <button onClick={undo} disabled={ops.length === 0} title="undo" className="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-neutral-800" aria-label="undo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
        </button>
        <button onClick={redo} disabled={redoStack.length === 0} title="redo" className="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-neutral-800" aria-label="redo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />
          </svg>
        </button>
        <button onClick={() => { setOps([]); setRedoStack([]); setLayers((prev) => prev.map((l) => ({ ...l, keys: [] }))); setFrameLabel("cleared"); }} disabled={ops.length === 0} title="clear board" className="rounded-lg p-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950" aria-label="clear board">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
