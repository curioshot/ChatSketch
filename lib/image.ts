// background photo to trace over, fitted into the 1000 board
export type BgImage = { src: string; w: number; h: number };

// fitting an image inside the board, centered
export function fitBg(w: number, h: number, bw = 1000, bh = 1000): { x: number; y: number; w: number; h: number } {
  const k = Math.min(bw / w, bh / h);
  const fw = Math.round(w * k);
  const fh = Math.round(h * k);
  return { x: Math.round((bw - fw) / 2), y: Math.round((bh - fh) / 2), w: fw, h: fh };
}

// downscaling uploads so localStorage never chokes
export function fileToBg(file: File): Promise<BgImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1200 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ src: c.toDataURL("image/jpeg", 0.85), w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}
