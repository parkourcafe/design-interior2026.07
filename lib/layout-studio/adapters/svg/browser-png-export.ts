import type { LayoutDocument } from "../../domain";
import { renderLayoutSvg } from "./svg-projection";

export class BrowserPngExportAdapter {
  async render(document: LayoutDocument, width: number, height: number): Promise<Uint8Array> {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("INVALID_PNG_SIZE");
    const blob = new Blob([renderLayoutSvg(document)], { type: "image/svg+xml" }); const url = URL.createObjectURL(blob);
    try { const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("SVG_RASTERIZE_FAILED")); image.src = url; }); const canvas = documentGlobal().createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); if (!context) throw new Error("CANVAS_UNAVAILABLE"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height); const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG_ENCODE_FAILED")), "image/png")); return new Uint8Array(await png.arrayBuffer()); }
    finally { URL.revokeObjectURL(url); }
  }
}

function documentGlobal(): Document { if (typeof window === "undefined") throw new Error("BROWSER_ONLY_ADAPTER"); return window.document; }
