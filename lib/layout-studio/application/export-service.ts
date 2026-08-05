import { canonicalJson, semanticHash, validateLayoutDocument, type LayoutVersion } from "../domain";
import type { GlbExporter, PngExporter, PrintExporter, SvgExporter } from "./ports";
import type { LayoutRepository } from "./ports";

export type ExportFormat = "json" | "svg" | "png" | "glb" | "print";
export interface ExportManifest { artifactId: string; format: ExportFormat; filename: string; mimeType: string; byteLength: number; documentId: string; versionId: string; semanticHash: string; generatedAt: string; warnings: string[]; disclaimer: string }
export interface ExportArtifact { bytes: Uint8Array; manifest: ExportManifest }

const privacyPatterns = [/\/Users\//i, /file:\/\//i, /service[_-]?role/i, /supabase[^\s]*token/i, /@[a-z0-9.-]+\.[a-z]{2,}/i];
function assertPrivateSafe(value: Uint8Array) { const text = new TextDecoder().decode(value); if (privacyPatterns.some((pattern) => pattern.test(text))) throw new Error("EXPORT_PRIVACY_VIOLATION"); }

export class LayoutExportService {
  constructor(private readonly repository: LayoutRepository, private readonly adapters: { svg: SvgExporter; glb: GlbExporter; png?: PngExporter; print?: PrintExporter }) {}
  async export(versionId: string, format: ExportFormat, size = { width: 1600, height: 1000 }): Promise<ExportArtifact> {
    const version = await this.repository.loadVersion(versionId); if (!version) throw new Error("VERSION_NOT_FOUND");
    const validation = validateLayoutDocument(version.content); if (!validation.valid) throw new Error("VERSION_SCHEMA_INVALID");
    const hash = await semanticHash(version.content); if (hash !== version.semanticHash) throw new Error("SEMANTIC_HASH_MISMATCH");
    let bytes: Uint8Array; let extension = format; let mimeType = "application/octet-stream";
    if (format === "json") { bytes = new TextEncoder().encode(canonicalJson(version.content)); mimeType = "application/json"; }
    else if (format === "svg") { bytes = new TextEncoder().encode(this.adapters.svg.render(version.content)); mimeType = "image/svg+xml"; }
    else if (format === "glb") { bytes = await this.adapters.glb.render(version.content); mimeType = "model/gltf-binary"; }
    else if (format === "png") { if (!this.adapters.png) throw new Error("PNG_ADAPTER_UNAVAILABLE"); bytes = await this.adapters.png.render(version.content, size.width, size.height); mimeType = "image/png"; }
    else { if (!this.adapters.print) throw new Error("PRINT_ADAPTER_UNAVAILABLE"); const svg = this.adapters.svg.render(version.content); const html = this.adapters.print.render(version.content, svg, { versionId, semanticHash: hash, warnings: validation.issues }); bytes = new TextEncoder().encode(html); mimeType = "text/html"; extension = "html"; }
    assertPrivateSafe(bytes);
    const filename = `${version.documentId}.${version.versionId}.${extension}`;
    return { bytes, manifest: { artifactId: `artifact.${crypto.randomUUID()}`, format, filename, mimeType, byteLength: bytes.byteLength, documentId: version.documentId, versionId: version.versionId, semanticHash: hash, generatedAt: new Date().toISOString(), warnings: validation.issues.filter((issue) => issue.severity !== "info").map((issue) => issue.code), disclaimer: "Проектная модель ArchiDom. Перед строительством требуется проверка и утверждение человеком." } };
  }
}
