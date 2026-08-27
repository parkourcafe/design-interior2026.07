export interface TelegramLease {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly attempt: number;
  readonly expiresAt: number;
}

export class TelegramLeaseError extends Error {
  constructor(readonly code: "already_leased" | "fenced" | "expired") {
    super(`telegram_lease_${code}`);
    this.name = "TelegramLeaseError";
  }
}

export class TelegramLeaseBook {
  private readonly leases = new Map<string, TelegramLease>();

  claim(jobId: string, nowMs: number, ttlMs: number, token: string): TelegramLease {
    const current = this.leases.get(jobId);
    if (current && current.expiresAt > nowMs) throw new TelegramLeaseError("already_leased");
    const lease: TelegramLease = {
      jobId,
      leaseToken: token,
      attempt: (current?.attempt ?? 0) + 1,
      expiresAt: nowMs + ttlMs,
    };
    this.leases.set(jobId, lease);
    return lease;
  }

  assertCurrent(jobId: string, token: string, nowMs: number): TelegramLease {
    const lease = this.leases.get(jobId);
    if (!lease || lease.leaseToken !== token) throw new TelegramLeaseError("fenced");
    if (lease.expiresAt <= nowMs) throw new TelegramLeaseError("expired");
    return lease;
  }
}
