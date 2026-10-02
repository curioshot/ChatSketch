"use client";

import { useState } from "react";
import type { Layer } from "@/lib/drawings";

// floating layers panel: pick active, hide, rename, reorder, delete
export default function LayersPanel({
  layers,
  activeId,
  counts,
  disabled,
  onSelect,
  onToggle,
  onRename,
  onAdd,
  onRemove,
  onMove,
  onClose,
}: {
  layers: Layer[];
  activeId: string;
  counts: Record<string, number>;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onClose: () => void;
}) {
  // which layer is being renamed
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");

  function commitRename(id: string) {
    const t = nameValue.trim().slice(0, 30);
    if (t) onRename(id, t);
    setRenaming(null);
  }

  return (
    <div inert={disabled} className="absolute right-4 top-1/2 z-20 flex max-h-[55vh] w-60 -translate-y-1/2 flex-col rounded-2xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900">
      {disabled && <div title="Doodle is working…" className="absolute inset-0 z-10 cursor-wait rounded-2xl bg-white/40 dark:bg-black/30" />}
      <div className="flex items-center justify-between border-b border-gray-100 p-2.5 dark:border-neutral-700">
        <span className="text-sm font-medium">Layers ({layers.length})</span>
        <div className="flex gap-1">
          <button
            onClick={onAdd}
            title="add layer"
            aria-label="add layer"
            className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            onClick={onClose}
            aria-label="close layers"
            className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {layers.map((l, idx) => {
          const active = l.id === activeId;
          return (
            <div
              key={l.id}
              className={`rounded-xl border px-2 py-1.5 transition-colors ${active ? "border-black dark:border-white" : "border-transparent hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onToggle(l.id)}
                  title={l.visible ? "hide layer" : "show layer"}
                  aria-label={`${l.visible ? "hide" : "show"} ${l.name}`}
                  className="rounded p-0.5 text-gray-500 transition-colors hover:text-black dark:hover:text-white"
                >
                  {l.visible ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-4.94M9.9 4.24A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                      <path d="m2 2 20 20" />
                    </svg>
                  )}
                </button>
                {renaming === l.id ? (
                  <input
                    autoFocus
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(l.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => commitRename(l.id)}
                    aria-label="layer name"
                    className="min-w-0 flex-1 rounded border border-black bg-transparent px-1 text-xs outline-none dark:border-white dark:bg-neutral-800"
                  />
                ) : (
                  <button
                    onClick={() => onSelect(l.id)}
                    title="draw on this layer"
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium"
                  >
                    {l.name}
                    <span className="ml-1 font-normal text-gray-400">{counts[l.id] || 0}</span>
                  </button>
                )}
                <span className="flex shrink-0">
                  <button
                    onClick={() => onMove(l.id, -1)}
                    disabled={idx === 0}
                    title="move up"
                    aria-label={`move ${l.name} up`}
                    className="rounded p-0.5 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m18 15-6-6-6 6" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onMove(l.id, 1)}
                    disabled={idx === layers.length - 1}
                    title="move down"
                    aria-label={`move ${l.name} down`}
                    className="rounded p-0.5 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setNameValue(l.name);
                      setRenaming(l.id);
                    }}
                    title="rename layer"
                    aria-label={`rename ${l.name}`}
                    className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRemove(l.id)}
                    disabled={layers.length <= 1}
                    title="delete layer and its strokes"
                    aria-label={`delete ${l.name}`}
                    className="rounded p-0.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-gray-100 px-2.5 py-1.5 text-[11px] text-gray-500 dark:border-neutral-700 dark:text-gray-400">
        new strokes go to the boxed layer
      </p>
    </div>
  );
}
