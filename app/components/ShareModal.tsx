"use client";

import { useEffect, useState } from "react";

// share modal: start a live room, copy the link, stop anytime
export default function ShareModal({
  open,
  live,
  canLive,
  link,
  onStart,
  onStop,
  onClose,
}: {
  open: boolean;
  live: boolean;
  canLive: boolean;
  link: string;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // closing with Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function copy() {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done).catch(done);
    else done();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Share this drawing</h2>
          <button onClick={onClose} className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800" aria-label="close share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!canLive ? (
          <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
            <p className="font-medium">Live sharing needs keys</p>
            <p className="mt-1">Add a secret from the liveblocks.io dashboard to .env.local and restart:</p>
            <p className="mt-1 font-mono">LIVEBLOCKS_SECRET_KEY=sk-...</p>
            <p className="font-mono">NEXT_PUBLIC_LIVE_ENABLED=true</p>
          </div>
        ) : !live ? (
          <>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Anyone with the link draws on the same canvas with you, live cursors included.
            </p>
            <button
              onClick={onStart}
              className="mt-3 w-full rounded-xl bg-black py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
            >
              Start sharing
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              Live now — anyone opening the link joins the room.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={link}
                aria-label="share link"
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none dark:border-neutral-700 dark:bg-neutral-800"
              />
              <button
                onClick={copy}
                className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={onStop}
              className="mt-3 w-full rounded-xl border border-gray-200 py-2 text-sm transition-colors hover:bg-red-50 hover:text-red-600 dark:border-neutral-700 dark:hover:bg-red-950"
            >
              Stop sharing
            </button>
          </>
        )}
      </div>
    </div>
  );
}
