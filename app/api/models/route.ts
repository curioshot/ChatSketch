import { NextResponse } from "next/server";

// resolving endpoint per provider, custom uses its own base url
function resolveBase(provider: string, baseUrl: string): string {
  if (provider === "nvidia") return "https://integrate.api.nvidia.com/v1";
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai";
  return (baseUrl || "").replace(/\/$/, "");
}

// anthropic uses its own key header and models shape
async function anthropicModels(apiKey: string): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
}

// checking key by listing models, never storing the key here
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || "nvidia");
  const apiKey = String(body.apiKey || "").trim();
  const base = resolveBase(provider, String(body.baseUrl || ""));
  // testKey runs a tiny real completion, since some list endpoints are public
  const testKey = body.testKey === true;

  if (!apiKey) return NextResponse.json({ error: "missing api key" }, { status: 400 });
  if (!base) return NextResponse.json({ error: "missing base url" }, { status: 400 });

  const started = Date.now();
  try {
    if (testKey) {
      // one tiny greeting proves the key truly works
      const check =
        provider === "anthropic"
          ? await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({ model: String(body.model || "claude-3-5-haiku-latest"), max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
            })
          : await fetch(`${base}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: String(body.model || "test"),
                messages: [{ role: "user", content: "hi" }],
                temperature: 0,
                max_tokens: 5,
              }),
            });
      if (!check.ok) {
        return NextResponse.json({ error: "key rejected, check provider and key" }, { status: 401 });
      }
    }
    const res =
      provider === "anthropic"
        ? await anthropicModels(apiKey)
        : await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
    if (!res.ok) {
      // key passed the live check but list failed, still reporting ok
      if (testKey) return NextResponse.json({ ok: true, latencyMs: Date.now() - started, models: [] });
      return NextResponse.json({ error: "key rejected, check provider and key" }, { status: 401 });
    }
    const data = await res.json();
    const raw = Array.isArray(data.data) ? data.data : [];
    const list = raw
      .map((m: { id?: string; name?: string }) => String(m.id || m.name || ""))
      .filter(Boolean);
    return NextResponse.json({ ok: testKey ? true : undefined, latencyMs: testKey ? Date.now() - started : undefined, models: list.slice(0, 100) });
  } catch {
    return NextResponse.json({ error: "cannot reach provider" }, { status: 502 });
  }
}
