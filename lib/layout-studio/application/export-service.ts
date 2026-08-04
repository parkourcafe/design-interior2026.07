import {
  createSvgProjection,
  serializeSvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import { deriveLayout, type LayoutDocument } from "@/lib/layout-studio/domain";

interface ExportableLayoutVersion {
  versionId: string;
  documentId: string;
  semanticHash: string;
  content: LayoutDocument;
}

export interface LayoutVersionReader {
  loadVersion(versionId: string): Promise<ExportableLayoutVersion | null>;
}

export type LayoutExportFormat = "json" | "svg";

export interface LayoutExportManifest {
  contractVersion: "archidom.layout-export/0.1";
  documentId: string;
  versionId: string;
  semanticHash: string;
  artifactChecksum: string;
  generatedAt: string;
  generatorVersion: string;
}

export interface LayoutExportResult {
  format: LayoutExportFormat;
  artifact: string;
  manifest: LayoutExportManifest;
}

export class LayoutExportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LayoutExportError";
  }
}

export interface LayoutExportServiceOptions {
  repository: LayoutVersionReader;
  generatorVersion: string;
  now?: () => string;
}

const PRIVATE_REFERENCE =
  /(?:^|[\s"'=(])\/(?!\/)[^\s"'<>]+|[A-Za-z]:\\|file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1)(?=[:/]|$)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth[_-]?token|signed[_-]?url|localStorage/i;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertPublicExport(value: unknown): void {
  const inspected = new WeakSet<object>();
  const containsPrivateReference = (candidate: unknown): boolean => {
    if (typeof candidate === "string") return PRIVATE_REFERENCE.test(candidate);
    if (typeof candidate !== "object" || candidate === null || inspected.has(candidate)) {
      return false;
    }

    inspected.add(candidate);
    return Object.entries(candidate).some(
      ([key, nested]) => PRIVATE_REFERENCE.test(key) || containsPrivateReference(nested),
    );
  };

  if (containsPrivateReference(value)) {
    throw new LayoutExportError(
      "EXPORT_PRIVACY_VIOLATION",
      "Экспорт содержит приватную ссылку или локальный идентификатор",
    );
  }
}

export class LayoutExportService {
  private readonly now: () => string;

  constructor(private readonly options: LayoutExportServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async exportVersion(
    versionId: string,
    format: LayoutExportFormat,
  ): Promise<LayoutExportResult> {
    const version = await this.options.repository.loadVersion(versionId);
    if (!version) {
      throw new LayoutExportError("VERSION_NOT_FOUND", "Версия для экспорта не найдена");
    }

    assertPublicExport(version.content);
    const artifact =
      format === "json"
        ? JSON.stringify({
            versionId: version.versionId,
            semanticHash: version.semanticHash,
            content: version.content,
          })
        : serializeSvgProjection(
            createSvgProjection(deriveLayout(version.content), { versionId: version.versionId }),
          );

    const exported: LayoutExportResult = {
      format,
      artifact,
      manifest: {
        contractVersion: "archidom.layout-export/0.1",
        documentId: version.documentId,
        versionId: version.versionId,
        semanticHash: version.semanticHash,
        artifactChecksum: await sha256(artifact),
        generatedAt: this.now(),
        generatorVersion: this.options.generatorVersion,
      },
    };
    assertPublicExport(exported);
    return exported;
  }
}
