// rough token math and model limits for the context meter
// estimate: plain text runs about 4 chars per token
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// context window per model family, fallback by provider
export function contextLimit(model: string, provider: string): number {
  const m = (model || "").toLowerCase();
  if (/claude/.test(m)) return 200000;
  if (/gemini|gemma/.test(m)) return 1000000;
  if (/gpt|llama|mistral|mixtral|deepseek|qwen|nemotron|phi/.test(m)) return 128000;
  if (provider === "anthropic") return 200000;
  if (provider === "gemini") return 1000000;
  return 128000;
}

// short display like 1.2k or 3.4M
export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}
