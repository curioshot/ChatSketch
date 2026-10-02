// turning ops into downloadable files, no extra libs needed
import { arrowHead, brushPasses, orderedVisibleOps, starPoints, triPoints, type Drawing, type DrawOp } from "./drawings";
import { fitBg } from "./image";
import { sanitizeSvgInner } from "./svg";

const S = 1000;

// white for eraser so exports match what the board shows
function ink(o: DrawOp): string {
  if (o.op === "svg") return "#000000";
  return o.tool === "eraser" ? "#ffffff" : o.color;
}

// escaping user text for the svg file
function escXml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// safe file name from drawing title
export function fileName(title: string, ext: string): string {
  const base =
    title
      .trim()
      .replace(/[^\w\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "drawing";
  return `${base}.${ext}`;
}

// full standalone svg file with white background, honoring layers
export function opsToSvg(d: Drawing): string {
  const photo = d.bg
    ? (() => {
        const b = d.bg as { src: string; w: number; h: number };
        const f = fitBg(b.w, b.h);
        return `<image href="${b.src}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="xMidYMid meet"/>`;
      })()
    : "";
  const inner = orderedVisibleOps(d.ops, d.layers)
    .map((o) => {
      if (o.op === "svg") return sanitizeSvgInner(o.markup);
      const c = ink(o);
      // one element per brush pass so glow styles survive export
      return brushPasses(o)
        .map((p) => {
          const w = o.op === "text" ? 0 : o.strokeWidth * p.wMul;
          const a = p.alpha === 1 ? "" : ` opacity="${p.alpha}"`;
          if (o.op === "line")
            return `<line x1="${o.from[0]}" y1="${o.from[1]}" x2="${o.to[0]}" y2="${o.to[1]}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${a}/>`;
          if (o.op === "polyline")
            return `<polyline points="${o.points.map((pt) => pt.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${a}/>`;
          if (o.op === "bezier")
            return `<path d="M${o.from[0]} ${o.from[1]} C${o.cp1[0]} ${o.cp1[1]} ${o.cp2[0]} ${o.cp2[1]} ${o.to[0]} ${o.to[1]}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${a}/>`;
          if (o.op === "circle")
            return `<circle cx="${o.center[0]}" cy="${o.center[1]}" r="${o.r}" fill="${o.fill ? c : "none"}" stroke="${c}" stroke-width="${w}"${a}/>`;
          if (o.op === "rect")
            return `<rect x="${o.center[0] - o.w / 2}" y="${o.center[1] - o.h / 2}" width="${o.w}" height="${o.h}" fill="${o.fill ? c : "none"}" stroke="${c}" stroke-width="${w}"${a}/>`;
          if (o.op === "ellipse")
            return `<ellipse cx="${o.center[0]}" cy="${o.center[1]}" rx="${Math.max(1, o.rx)}" ry="${Math.max(1, o.ry)}" fill="${o.fill ? c : "none"}" stroke="${c}" stroke-width="${w}"${a}/>`;
          if (o.op === "triangle" || o.op === "star") {
            const pts = (o.op === "triangle"
              ? triPoints(o.center[0], o.center[1], o.w, o.h)
              : starPoints(o.center[0], o.center[1], o.r)
            ).map((pt) => pt.join(",")).join(" ");
            return `<polygon points="${pts}" fill="${o.fill ? c : "none"}" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"${a}/>`;
          }
          if (o.op === "arrow") {
            const [h1, h2] = arrowHead(o.from, o.to, o.strokeWidth);
            return `<g stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"${a}><line x1="${o.from[0]}" y1="${o.from[1]}" x2="${o.to[0]}" y2="${o.to[1]}"/><path d="M${h1[0]} ${h1[1]} L${o.to[0]} ${o.to[1]} L${h2[0]} ${h2[1]}"/></g>`;
          }
          return `<text x="${o.center[0]}" y="${o.center[1]}" font-size="${o.size}" font-family="system-ui, sans-serif" fill="${c}" text-anchor="middle" dominant-baseline="central">${escXml(o.content)}</text>`;
        })
        .join("");
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="#ffffff"/>${photo}${inner}</svg>`;
}

// rasterizing through the svg file so injected artwork exports too
export function rasterize(svg: string, px: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = px;
      c.height = Math.max(1, Math.round((px * img.height) / (img.width || 1)));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("rasterize failed"));
    };
    img.src = url;
  });
}

// triggering a browser download
function trigger(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadSvg(d: Drawing) {
  const blob = new Blob([opsToSvg(d)], { type: "image/svg+xml" });
  trigger(URL.createObjectURL(blob), fileName(d.title, "svg"));
}

export async function downloadJpg(d: Drawing) {
  const c = await rasterize(opsToSvg(d), 2000);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.92));
  if (blob) trigger(URL.createObjectURL(blob), fileName(d.title, "jpg"));
}

export async function downloadPng(d: Drawing) {
  const c = await rasterize(opsToSvg(d), 2000);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (blob) trigger(URL.createObjectURL(blob), fileName(d.title, "png"));
}

// tiny one-image pdf writer, so we need no pdf library
export async function downloadPdf(d: Drawing) {
  const c = await rasterize(opsToSvg(d), 1500);
  const W = c.width;
  const H = c.height;
  const bin = atob(c.toDataURL("image/jpeg", 0.9).split(",")[1]);
  const img = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);

  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  // collecting parts while tracking byte offsets for the xref table
  function pushText(t: string) {
    const b = enc.encode(t);
    chunks.push(b);
    pos += b.length;
  }
  pushText("%PDF-1.4\n");
  offsets.push(pos);
  pushText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets.push(pos);
  pushText("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offsets.push(pos);
  pushText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );
  offsets.push(pos);
  pushText(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`
  );
  chunks.push(img);
  pos += img.length;
  pushText("\nendstream\nendobj\n");
  offsets.push(pos);
  const contentBytes = enc.encode(content);
  pushText(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  chunks.push(contentBytes);
  pos += contentBytes.length;
  pushText("\nendstream\nendobj\n");

  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  pushText(xref);

  const total = new Uint8Array(pos);
  let at = 0;
  for (const ch of chunks) {
    total.set(ch, at);
    at += ch.length;
  }
  trigger(URL.createObjectURL(new Blob([total], { type: "application/pdf" })), fileName(d.title, "pdf"));
}
