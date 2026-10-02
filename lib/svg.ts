// strict allowlist sanitizer for raw svg markup, runs in the browser
const ALLOWED_TAGS = new Set([
  "g", "line", "polyline", "polygon", "path", "circle", "ellipse",
  "rect", "text", "tspan",
]);

const ALLOWED_ATTRS = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "points", "d", "fill", "stroke", "stroke-width",
  "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-family",
  "text-anchor", "dominant-baseline", "transform", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray",
]);

// dropping everything not on the lists: no scripts, no handlers, no links
function scrub(node: Element) {
  for (const child of Array.from(node.children)) {
    if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
    }
    scrub(child);
  }
}

// returns safe inner markup for a 1000x1000 viewport, "" when nothing usable
export function sanitizeSvgInner(markup: string): string {
  const src = String(markup || "").slice(0, 50000);
  if (!src.includes("<")) return "";
  try {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${src}</svg>`,
      "image/svg+xml"
    );
    if (doc.querySelector("parsererror")) return "";
    const root = doc.documentElement;
    scrub(root);
    return root.innerHTML.trim();
  } catch {
    return "";
  }
}
