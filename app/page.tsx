"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SettingsModal from "./components/SettingsModal";
import Splash from "./components/Splash";
import Logo from "./components/Logo";
import {
  BOARD_SIZE,
  Drawing,
  Mode,
  SIZE_PRESETS,
  arrowHead,
  brushPasses,
  cleanSize,
  createDrawing,
  loadAll,
  orderedVisibleOps,
  removeDrawing,
  starPoints,
  triPoints,
} from "@/lib/drawings";
import { downloadJpg, downloadPdf, downloadPng, downloadSvg } from "@/lib/export";
import { fitBg } from "@/lib/image";
import { sanitizeSvgInner } from "@/lib/svg";
import { applySettings, loadSettings } from "@/lib/settings";

// same look for small header icon buttons
const iconBtn =
  "rounded-xl border border-gray-200 p-2 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800";

// small preview, showing first strokes only so cards stay fast
function Preview({ d }: { d: Drawing }) {
  const ops = orderedVisibleOps(d.ops, d.layers).slice(0, 20);
  const bg = d.bg ? { src: d.bg.src, ...fitBg(d.bg.w, d.bg.h, d.size?.w || 1000, d.size?.h || 1000) } : null;
  const sw = d.size?.w || 1000;
  const sh = d.size?.h || 1000;
  return (
    <svg viewBox={`0 0 ${sw} ${sh}`} className="h-36 w-full border-b border-gray-100 bg-white dark:border-neutral-800 dark:bg-neutral-800">
      {bg && <image href={bg.src} x={bg.x} y={bg.y} width={bg.w} height={bg.h} />}
      {ops.map((o, i) => {
        if (o.op === "svg")
          return <g key={i} dangerouslySetInnerHTML={{ __html: sanitizeSvgInner(o.markup) }} />;
        const col = o.tool === "eraser" ? "white" : o.color;
        const passes = brushPasses(o);
        const one = (wMul: number, alpha: number, k: number | string) => {
          const w = o.op === "text" ? 0 : o.strokeWidth * wMul;
          const op = { opacity: alpha };
          if (o.op === "line")
            return <line key={k} x1={o.from[0]} y1={o.from[1]} x2={o.to[0]} y2={o.to[1]} stroke={col} strokeWidth={w} strokeLinecap="round" {...op} />;
          if (o.op === "polyline")
            return <polyline key={k} points={o.points.map((p) => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...op} />;
          if (o.op === "bezier")
            return <path key={k} d={`M${o.from[0]} ${o.from[1]} C${o.cp1[0]} ${o.cp1[1]} ${o.cp2[0]} ${o.cp2[1]} ${o.to[0]} ${o.to[1]}`} fill="none" stroke={col} strokeWidth={w} {...op} />;
          if (o.op === "circle")
            return <circle key={k} cx={o.center[0]} cy={o.center[1]} r={o.r} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} />;
          if (o.op === "rect")
            return <rect key={k} x={o.center[0] - o.w / 2} y={o.center[1] - o.h / 2} width={o.w} height={o.h} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} />;
          if (o.op === "ellipse")
            return <ellipse key={k} cx={o.center[0]} cy={o.center[1]} rx={Math.max(1, o.rx)} ry={Math.max(1, o.ry)} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} {...op} />;
          if (o.op === "triangle" || o.op === "star") {
            const pts = (o.op === "triangle"
              ? triPoints(o.center[0], o.center[1], o.w, o.h)
              : starPoints(o.center[0], o.center[1], o.r)
            ).map((p) => p.join(",")).join(" ");
            return <polygon key={k} points={pts} fill={o.fill ? col : "none"} stroke={col} strokeWidth={w} strokeLinejoin="round" {...op} />;
          }
          if (o.op === "arrow") {
            const [h1, h2] = arrowHead(o.from, o.to, o.strokeWidth);
            return (
              <g key={k} stroke={col} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" {...op}>
                <line x1={o.from[0]} y1={o.from[1]} x2={o.to[0]} y2={o.to[1]} />
                <path d={`M${h1[0]} ${h1[1]} L${o.to[0]} ${o.to[1]} L${h2[0]} ${h2[1]}`} />
              </g>
            );
          }
          return <text key={k} x={o.center[0]} y={o.center[1]} fontSize={o.size} fill={col} textAnchor="middle" dominantBaseline="central">{o.content}</text>;
        };
        if (passes.length === 1) return one(passes[0].wMul, passes[0].alpha, i);
        return <g key={i}>{passes.map((p, k) => one(p.wMul, p.alpha, `${i}-${k}`))}</g>;
      })}
      {ops.length === 0 && (
        <text x="500" y="520" textAnchor="middle" fontSize="48" fill="#ccc">
          empty
        </text>
      )}
    </svg>
  );
}

export default function Dashboard() {
  const router = useRouter();
  // starting empty so server and first client paint match, real list loads after mount
  const [items, setItems] = useState<Drawing[]>([]);
  // create dialog open or not
  const [picking, setPicking] = useState(false);
  // settings popup open or not
  const [settingsOpen, setSettingsOpen] = useState(false);
  // which card menu is open, only one at a time
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  // export formats row inside the menu
  const [exportOpen, setExportOpen] = useState(false);
  // which card is being renamed
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // current theme for the toggle icon
  const [dark, setDark] = useState(false);

  // applying saved theme + font and loading list after mount (localStorage is client only)
  useEffect(() => {
    const s = loadSettings();
    applySettings(s);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(loadAll());
    setDark(s.theme === "dark");
    const refresh = () => setItems(loadAll());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPicking(false);
      closeMenu();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // flipping light/dark and saving it
  function toggleTheme() {
    const s = loadSettings();
    const next = { ...s, theme: (s.theme === "dark" ? "light" : "dark") as "light" | "dark" };
    applySettings(next);
    try {
      localStorage.setItem("ai-board-settings-v1", JSON.stringify(next));
    } catch {
      // storage blocked, theme still applies for this visit
    }
    setDark(next.theme === "dark");
  }

  // creating after user picks mode, with the chosen paper size
  const [sizeId, setSizeId] = useState("square");
  const [customW, setCustomW] = useState("1000");
  const [customH, setCustomH] = useState("1000");
  // two-step flow: pick mode first, then paper
  const [pickStep, setPickStep] = useState<1 | 2>(1);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  function openPicking() {
    setPendingMode(null);
    setPickStep(1);
    setPicking(true);
  }
  function chooseMode(mode: Mode) {
    setPendingMode(mode);
    setPickStep(2);
  }
  function pickedSize() {
    if (sizeId === "custom") return cleanSize(Number(customW), Number(customH));
    const p = SIZE_PRESETS.find((s) => s.id === sizeId);
    return p ? { w: p.w, h: p.h } : { w: BOARD_SIZE, h: BOARD_SIZE };
  }
  function create(mode: Mode) {
    const d = createDrawing(mode, pickedSize());
    setPicking(false);
    setPickStep(1);
    setPendingMode(null);
    router.push(`/board/${d.id}`);
  }

  function remove(id: string) {
    removeDrawing(id);
    closeMenu();
    setItems(loadAll());
  }

  // closing the card menu and its export row together
  function closeMenu() {
    setMenuOpen(null);
    setExportOpen(false);
  }

  // exporting a card, then closing the menu
  async function doExport(d: Drawing, fmt: "pdf" | "jpg" | "png" | "svg") {
    try {
      if (fmt === "pdf") await downloadPdf(d);
      else if (fmt === "jpg") await downloadJpg(d);
      else if (fmt === "png") await downloadPng(d);
      else downloadSvg(d);
    } catch {
      // rasterize can fail on odd markup, menu still closes
    }
    closeMenu();
  }

  // starting inline rename on a card
  function startRename(d: Drawing) {
    setRenaming(d.id);
    setRenameValue(d.title);
    closeMenu();
  }

  // saving the new title, keeping old one if empty
  function saveRename(d: Drawing) {
    const t = renameValue.trim();
    if (t) {
      const all = loadAll();
      const i = all.findIndex((x) => x.id === d.id);
      if (i !== -1) {
        all[i] = { ...all[i], title: t, updatedAt: Date.now() };
        try {
          localStorage.setItem("ai-board-drawings-v1", JSON.stringify(all));
        } catch {
          // storage blocked, list still updates for this visit
        }
        setItems(all);
      }
    }
    setRenaming(null);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Splash />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <div>
            <h1 className="text-xl font-bold tracking-tight">ChatSketch</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">my drawings — pick one to open, or make a new one</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* light/dark toggle */}
          <button
            onClick={toggleTheme}
            className={iconBtn}
            aria-label="toggle dark mode"
            title={dark ? "switch to light mode" : "switch to dark mode"}
          >
            {dark ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
              </svg>
            )}
          </button>
          {/* settings popup trigger */}
          <button
            onClick={() => setSettingsOpen(true)}
            className={iconBtn}
            aria-label="open settings"
            title="settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
          <button
            onClick={() => openPicking()}
            className="flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-10 text-center dark:border-neutral-700">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
            <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
            <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400">nothing here yet</p>
          <button onClick={() => openPicking()} className="rounded-xl bg-black px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black">
            make your first drawing
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
          {items.map((d) => (
            <div key={d.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40">
              <button onClick={() => router.push(`/board/${d.id}`)} className="block w-full text-left" aria-label={`open ${d.title}`}>
                <Preview d={d} />
              </button>
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0 flex-1">
                  {renaming === d.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(d);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => saveRename(d)}
                      aria-label="rename drawing"
                      className="w-full rounded-lg border border-black px-1.5 py-0.5 text-sm font-medium outline-none dark:border-white dark:bg-neutral-800"
                    />
                  ) : (
                    <p className="truncate text-sm font-medium">{d.title}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {d.mode === "svg" ? "svg" : "sketch"} · {d.size?.w || 1000}×{d.size?.h || 1000} · {new Date(d.updatedAt).toLocaleString()}
                  </p>
                </div>
                {/* three dot menu with open, rename, delete */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => {
                      setMenuOpen(menuOpen === d.id ? null : d.id);
                      setExportOpen(false);
                    }}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
                    aria-label={`options for ${d.title}`}
                    aria-haspopup="menu"
                    title="options"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="12" cy="19" r="1.7" />
                    </svg>
                  </button>
                  {menuOpen === d.id && (
                    <>
                      <button
                        aria-label="close menu"
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => closeMenu()}
                      />
                      <div
                        role="menu"
                        className="absolute bottom-full right-0 z-40 mb-1 w-36 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <button
                          onClick={() => router.push(`/board/${d.id}`)}
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M7 17 17 7M8 7h9v9" />
                          </svg>
                          Open
                        </button>
                        <button
                          onClick={() => startRename(d)}
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                          Rename
                        </button>
                        {/* export row, expands to pdf/jpg/svg */}
                        <button
                          onClick={() => setExportOpen((v) => !v)}
                          role="menuitem"
                          aria-expanded={exportOpen}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          Export
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`ml-auto transition-transform ${exportOpen ? "rotate-180" : ""}`}>
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        {exportOpen && (
                          <div className="flex gap-1.5 px-3 pb-2 pt-0.5">
                            {(d.mode === "svg" ? (["svg"] as const) : (["pdf", "jpg", "png", "svg"] as const)).map((f) => (
                              <button
                                key={f}
                                onClick={() => doExport(d, f)}
                                className="flex-1 rounded-lg border border-gray-200 py-1 text-xs font-medium uppercase transition-colors hover:bg-black hover:text-white dark:border-neutral-700 dark:hover:bg-white dark:hover:text-black"
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => remove(d.id)}
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* two-step picker: mode first, then paper */}
      {picking && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setPicking(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pickStep === 1 ? (
              <>
                <h2 className="text-sm font-medium">What do you want to make?</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => chooseMode("brush-ops")}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                    </svg>
                    <span className="text-sm font-medium">Sketch</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">freehand canvas</span>
                  </button>
                  <button
                    onClick={() => chooseMode("svg")}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 3v18M3 12h18" />
                    </svg>
                    <span className="text-sm font-medium">SVG</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">clean vector</span>
                  </button>
                </div>
                <button onClick={() => setPicking(false)} className="mt-3 w-full rounded-xl border border-gray-200 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setPickStep(1)} className="text-xs text-gray-500 transition-colors hover:text-black dark:hover:text-white" aria-label="back to mode picker">
                  ← {pendingMode === "svg" ? "SVG" : "Sketch"} · change
                </button>
                <h2 className="mt-1 text-sm font-medium">Pick a paper size</h2>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {SIZE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSizeId(p.id)}
                      className={`rounded-xl border px-2 py-1.5 text-xs transition-colors ${sizeId === p.id ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSizeId("custom")}
                    className={`rounded-xl border px-2 py-1.5 text-xs transition-colors ${sizeId === "custom" ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                  >
                    Custom
                  </button>
                </div>
                {sizeId === "custom" && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                      inputMode="numeric"
                      aria-label="custom width"
                      placeholder="W"
                      className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-black dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-white"
                    />
                    <span className="text-gray-400">×</span>
                    <input
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                      inputMode="numeric"
                      aria-label="custom height"
                      placeholder="H"
                      className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-black dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-white"
                    />
                  </div>
                )}
                <button
                  onClick={() => pendingMode && create(pendingMode)}
                  className="mt-3 w-full rounded-xl bg-black py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Create {pendingMode === "svg" ? "SVG" : "sketch"}
                </button>
                <button onClick={() => setPicking(false)} className="mt-2 w-full rounded-xl border border-gray-200 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* settings popup with provider key + appearance */}
      {settingsOpen && (
        <SettingsModal
          open
          onClose={() => {
            setSettingsOpen(false);
            const s = loadSettings();
            applySettings(s);
            setDark(s.theme === "dark");
          }}
        />
      )}
    </div>
  );
}
