import {
  createSvgProjection,
  serializeSvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import { compileSceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";
import { exportSceneDescriptorToGlb } from "@/lib/layout-studio/adapters/three/glb-export";
import { buildPrintSummary } from "@/lib/layout-studio/application/print-summary";
import { deriveLayout, type LayoutDocument } from "@/lib/layout-studio/domain";

interface ExportableLayoutVersion {
  versionId: string;
  documentId: string;
  semanticHash: string;
  content: LayoutDocument;
  warnings?: string[];
}

export interface LayoutVersionReader {
  loadVersion(versionId: string): Promise<ExportableLayoutVersion | null>;
}

export type LayoutExportFormat = "json" | "svg" | "glb" | "print";

export type LayoutExportArtifact = string | Uint8Array<ArrayBuffer>;

export interface LayoutExportManifest {
  contractVersion: "archidom.layout-export/0.1";
  artifactId: string;
  format: LayoutExportFormat;
  filename: string;
  mimeType: string;
  byteLength: number;
  documentId: string;
  versionId: string;
  semanticHash: string;
  artifactChecksum: string;
  generatedAt: string;
  generatorVersion: string;
  warnings: string[];
}

export interface LayoutExportResult<Artifact extends LayoutExportArtifact = LayoutExportArtifact> {
  format: LayoutExportFormat;
  artifact: Artifact;
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

function artifactBytes(value: LayoutExportArtifact): Uint8Array<ArrayBuffer> {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

async function sha256(value: LayoutExportArtifact): Promise<string> {
  const bytes = artifactBytes(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertPublicExport(value: unknown): void {
  const inspected = new WeakSet<object>();
  const containsPrivateReference = (candidate: unknown): boolean => {
    if (typeof candidate === "string") return PRIVATE_REFERENCE.test(candidate);
    if (candidate instanceof Uint8Array) {
      return PRIVATE_REFERENCE.test(new TextDecoder().decode(candidate));
    }
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

const FORMAT_DETAILS: Record<
  LayoutExportFormat,
  { extension: "json" | "svg" | "glb" | "html"; mimeType: string }
> = {
  json: { extension: "json", mimeType: "application/json" },
  svg: { extension: "svg", mimeType: "image/svg+xml" },
  glb: { extension: "glb", mimeType: "model/gltf-binary" },
  print: { extension: "html", mimeType: "text/html" },
};

export class LayoutExportService {
  private readonly now: () => string;

  constructor(private readonly options: LayoutExportServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async exportVersion(
    versionId: string,
    format: "json" | "svg" | "print",
  ): Promise<LayoutExportResult<string>>;
  async exportVersion(
    versionId: string,
    format: "glb",
  ): Promise<LayoutExportResult<Uint8Array<ArrayBuffer>>>;
  async exportVersion(
    versionId: string,
    format: LayoutExportFormat,
  ): Promise<LayoutExportResult>;
  async exportVersion(
    versionId: string,
    format: LayoutExportFormat,
  ): Promise<LayoutExportResult> {
    const version = await this.options.repository.loadVersion(versionId);
    if (!version) {
      throw new LayoutExportError("VERSION_NOT_FOUND", "Версия для экспорта не найдена");
    }

    const warnings = [...(version.warnings ?? [])];
    assertPublicExport({ content: version.content, warnings });
    const derived = deriveLayout(version.content);
    let artifact: LayoutExportArtifact;
    switch (format) {
      case "json":
        artifact = JSON.stringify({
          versionId: version.versionId,
          semanticHash: version.semanticHash,
          content: version.content,
        });
        break;
      case "svg":
        artifact = serializeSvgProjection(
          createSvgProjection(derived, { versionId: version.versionId }),
        );
        break;
      case "glb":
        const nodesById = new Map(
          derived.sceneProjection.nodes.map((node) => [node.id, node] as const),
        );
        const wallDimensions = Object.fromEntries(
          derived.sceneProjection.walls.map((wall) => {
            const start = nodesById.get(wall.startNodeId);
            const end = nodesById.get(wall.endNodeId);
            const lengthMm = start && end ? Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm) : 0;
            return [
              wall.id,
              {
                widthM: lengthMm / 1000,
                heightM: wall.heightMm / 1000,
                depthM: wall.thicknessMm / 1000,
              },
            ];
          }),
        );
        artifact = exportSceneDescriptorToGlb(
          compileSceneDescriptor(derived.sceneProjection),
          { versionId: version.versionId, semanticHash: version.semanticHash },
          { dimensionsMBySourceId: wallDimensions },
        );
        break;
      case "print":
        artifact = buildPrintSummary({
          documentId: version.documentId,
          versionId: version.versionId,
          semanticHash: version.semanticHash,
          warnings,
        });
        break;
    }

    const formatDetails = FORMAT_DETAILS[format];
    const artifactId = `layout-${version.semanticHash.slice(0, 16)}-${format}`;

    const exported: LayoutExportResult = {
      format,
      artifact,
      manifest: {
        contractVersion: "archidom.layout-export/0.1",
        artifactId,
        format,
        filename: `${artifactId}.${formatDetails.extension}`,
        mimeType: formatDetails.mimeType,
        byteLength: artifactBytes(artifact).byteLength,
        documentId: version.documentId,
        versionId: version.versionId,
        semanticHash: version.semanticHash,
        artifactChecksum: await sha256(artifact),
        generatedAt: this.now(),
        generatorVersion: this.options.generatorVersion,
        warnings,
      },
    };
    assertPublicExport(exported);
    return exported;
  }
}
