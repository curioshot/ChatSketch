// central settings, stored locally so keys never leave this browser except to our own /api routes
export type Provider = "nvidia" | "openai" | "anthropic" | "gemini" | "custom";
export type Theme = "light" | "dark";

export type Settings = {
  theme: Theme;
  fontSize: number;
  fontFamily: "system" | "serif" | "mono";
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

const KEY = "ai-board-settings-v1";

// default endpoints per org
export function presetBaseUrl(p: Provider): string {
  if (p === "nvidia") return "https://integrate.api.nvidia.com/v1";
  if (p === "openai") return "https://api.openai.com/v1";
  if (p === "anthropic") return "https://api.anthropic.com/v1";
  if (p === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai";
  return "";
}

// sensible starting model per org, test button replaces it with the real list
export function presetModel(p: Provider): string {
  if (p === "nvidia") return "meta/llama-3.1-70b-instruct";
  if (p === "openai") return "gpt-4o-mini";
  if (p === "anthropic") return "claude-3-5-haiku-latest";
  if (p === "gemini") return "gemini-2.0-flash";
  return "";
}

// key hint per org
export function keyPlaceholder(p: Provider): string {
  if (p === "nvidia") return "nvapi-...";
  if (p === "openai") return "sk-...";
  if (p === "anthropic") return "sk-ant-...";
  if (p === "gemini") return "AIza...";
  return "paste key...";
}

// display name for the picker
export function providerLabel(p: Provider): string {
  if (p === "nvidia") return "NVIDIA";
  if (p === "openai") return "OpenAI";
  if (p === "anthropic") return "Anthropic";
  if (p === "gemini") return "Gemini";
  return "Other";
}

export function defaultSettings(): Settings {
  return {
    theme: "light",
    fontSize: 14,
    fontFamily: "system",
    provider: "nvidia",
    apiKey: "",
    model: presetModel("nvidia"),
    baseUrl: presetBaseUrl("nvidia"),
  };
}

// reading saved settings, merging over defaults
export function loadSettings(): Settings {
  const def = defaultSettings();
  if (typeof window === "undefined") return def;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    return { ...def, ...JSON.parse(raw) };
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  applySettings(s);
}

// applying theme + font to the whole page
export function applySettings(s: Settings) {
  const root = document.documentElement;
  root.classList.toggle("dark", s.theme === "dark");
  root.style.fontSize = `${s.fontSize}px`;
  const stack =
    s.fontFamily === "serif"
      ? "Georgia, serif"
      : s.fontFamily === "mono"
        ? "ui-monospace, monospace"
        : "system-ui, sans-serif";
  document.body.style.fontFamily = stack;
}
