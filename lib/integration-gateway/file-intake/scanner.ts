export const FILE_SCAN_OUTCOMES = ["clean", "infected", "scan_failed"] as const;
export type FileScanOutcome = (typeof FILE_SCAN_OUTCOMES)[number];

export interface FileMalwareScanner {
  scan(input: {
    readonly bytes: Uint8Array;
    readonly checksumHex: string;
    readonly mediaType: string;
  }): Promise<{ readonly outcome: FileScanOutcome }>;
}

/** Staging adapter used by tests until a real scanner is selected and gated. */
export class StagingFileMalwareScanner implements FileMalwareScanner {
  constructor(private readonly outcome: FileScanOutcome = "clean") {}

  async scan(_input: {
    readonly bytes: Uint8Array;
    readonly checksumHex: string;
    readonly mediaType: string;
  }): Promise<{ readonly outcome: FileScanOutcome }> {
    void _input;
    return { outcome: this.outcome };
  }
}
