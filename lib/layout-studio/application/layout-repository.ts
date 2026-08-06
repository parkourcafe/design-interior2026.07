import type {
  LayoutDocument,
  LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";

export interface VersionPublicationInput {
  versionId: string;
  parentVersionId?: string;
  reasonCode: string;
  reason: string;
}

export interface LayoutVersion {
  versionId: string;
  documentId: string;
  revisionId: string;
  revisionNo: number;
  createdAt: string;
  semanticHash: string;
  content: LayoutDocument;
}

export interface LayoutRepository {
  publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion>;
  loadVersion(versionId: string): Promise<LayoutVersion | null>;
  listVersions(documentId: string): Promise<LayoutVersion[]>;
  diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff>;
}
