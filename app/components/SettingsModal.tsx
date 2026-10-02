"use client";

import { useEffect, useState } from "react";
import {
  Provider,
  Settings,
  keyPlaceholder,
  loadSettings,
  presetBaseUrl,
  presetModel,
  providerLabel,
  saveSettings,
} from "@/lib/settings";

// shared input look so all fields match
const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none transition-colors focus:border-black dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-white";

type Tab = "provider" | "appearance";

// popup with two sections: provider settings and appearance, all local only
export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [s, setS] = useState<Settings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>("provider");
  // provider picker list open or not
  const [pickingProvider, setPickingProvider] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  // closing with Escape, same as clicking the backdrop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!open) return null;

  // switching org fills its endpoint and a starting model
  function pickProvider(p: Provider) {
    setS((prev) => ({
      ...prev,
      provider: p,
      baseUrl: p === "custom" ? prev.baseUrl : presetBaseUrl(p),
      model: p === "custom" ? prev.model : presetModel(p),
    }));
    setPickingProvider(false);
    setModels([]);
    setMsg("");
  }

  // saving theme + font + key together
  function save() {
    saveSettings(s);
    onClose();
  }

  // checking key with a tiny live call through our own /api route
  async function test() {
    if (!s.apiKey.trim()) {
      setMsg("enter an api key first");
      setOk(false);
      return;
    }
    setTesting(true);
    setMsg("");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: s.provider,
          apiKey: s.apiKey.trim(),
          baseUrl: s.baseUrl,
          model: s.model,
          testKey: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "key check failed");
        setOk(false);
        setModels([]);
      } else {
        const list = (data.models || []) as string[];
        setModels(list);
        const ms = typeof data.latencyMs === "number" ? ` • ${data.latencyMs}ms` : "";
        setMsg(`key works${ms} • ${list.length} models`);
        setOk(true);
        // preselecting first model if none picked
        if (!s.model && list.length) setS((prev) => ({ ...prev, model: list[0] }));
      }
    } catch {
      setMsg("network error, try again");
      setOk(false);
    }
    setTesting(false);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800" aria-label="close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* section tabs */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-neutral-800">
          <button
            onClick={() => setTab("provider")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${tab === "provider" ? "bg-white shadow-sm dark:bg-neutral-900" : "text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white"}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="7" rx="2" />
              <rect x="2" y="14" width="20" height="7" rx="2" />
            </svg>
            Provider
          </button>
          <button
            onClick={() => setTab("appearance")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${tab === "appearance" ? "bg-white shadow-sm dark:bg-neutral-900" : "text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white"}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 1.3-2.2-.8-1.3 0-3.2 1.7-3.2H17a4 4 0 0 0 4-4c0-1.2.5-2.4 1.3-3.2C21.4 4.5 17 3 12 3z" />
            </svg>
            Appearance
          </button>
        </div>

        {tab === "provider" && (
          <>
            {/* provider section, list appears after tapping choose */}
            <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">ORGANIZATION</p>
            <button
              onClick={() => setPickingProvider((v) => !v)}
              aria-expanded={pickingProvider}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <span>
                {pickingProvider ? "Choose provider" : providerLabel(s.provider)}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${pickingProvider ? "rotate-180" : ""}`}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {pickingProvider && (
              <div className="mt-2 space-y-1.5">
                {(["openai", "nvidia", "anthropic", "gemini", "custom"] as Provider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => pickProvider(p)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${s.provider === p ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                  >
                    {providerLabel(p)}
                    {s.provider === p && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

        <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">API key for {providerLabel(s.provider)}</label>
        <input
          type="password"
          value={s.apiKey}
          onChange={(e) => setS({ ...s, apiKey: e.target.value })}
          placeholder={keyPlaceholder(s.provider)}
          className={field}
        />

            {s.provider === "custom" && (
              <>
                <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">Base URL</label>
                <input
                  value={s.baseUrl}
                  onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
                  placeholder="https://your-endpoint/v1"
                  className={field}
                />
              </>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={test}
                disabled={testing}
                className="rounded-lg bg-black px-4 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {testing ? "testing..." : "Test"}
              </button>
              {msg && (
                <p className={`text-xs ${ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {msg}
                </p>
              )}
            </div>

            {/* models list from test, picking one saves it */}
            <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">
              {models.length > 0 ? `Model (${models.length})` : "Model name"}
            </label>
            {models.length > 0 ? (
              <select
                value={s.model}
                onChange={(e) => setS({ ...s, model: e.target.value })}
                className={field}
              >
                <option value="">pick a model...</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={s.model}
                onChange={(e) => setS({ ...s, model: e.target.value })}
                placeholder="meta/llama-3.1-70b-instruct"
                className={field}
              />
            )}
          </>
        )}

        {tab === "appearance" && (
          <>
            {/* theme section */}
            <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">THEME</p>
            <div className="mt-2 flex gap-2">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setS({ ...s, theme: t })}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm capitalize transition-colors ${s.theme === t ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                >
                  {t === "light" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
                    </svg>
                  )}
                  {t}
                </button>
              ))}
            </div>

            {/* font section */}
            <p className="mt-5 text-xs font-medium text-gray-500 dark:text-gray-400">FONT</p>
            <label className="mt-2 block text-xs text-gray-500 dark:text-gray-400">Size: {s.fontSize}px</label>
            <input
              type="range"
              min={12}
              max={20}
              value={s.fontSize}
              onChange={(e) => setS({ ...s, fontSize: Number(e.target.value) })}
              className="w-full accent-black dark:accent-white"
              aria-label="font size"
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["system", "serif", "mono"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setS({ ...s, fontFamily: f })}
                  className={`rounded-xl border px-2 py-2 text-sm capitalize transition-colors ${s.fontFamily === f ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* voice section */}
            <p className="mt-5 text-xs font-medium text-gray-500 dark:text-gray-400">VOICE</p>
            <button
              onClick={() => setS({ ...s, voiceOut: !s.voiceOut })}
              aria-pressed={s.voiceOut}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <span>Read replies aloud</span>
              <span className={`relative h-5 w-9 rounded-full transition-colors ${s.voiceOut ? "bg-black dark:bg-white" : "bg-gray-200 dark:bg-neutral-700"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all dark:bg-neutral-900 ${s.voiceOut ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          </>
        )}

        <button onClick={save} className="mt-5 w-full rounded-xl bg-black py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black">
          Save
        </button>
      </div>
    </div>
  );
}
