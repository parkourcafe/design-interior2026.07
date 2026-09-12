/**
 * The R1 delivery broker is intentionally infrastructure-neutral. It belongs
 * in the private data plane, not in a Next.js route: application Functions do
 * not proxy external-model bytes and the browser never receives a storage URL.
 *
 * `authorizer` must be backed by a request-bound server authorization for each
 * chunk. It is the only component allowed to receive a private storage locator.
 */
export const R1_DELIVERY_CHUNK_BYTES = 256 * 1024;
export const R1_DELIVERY_RECHECK_MS = 1000;

export type R1DeliveryErrorCode =
  | "unauthenticated"
  | "identity_unverified"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "expired"
  | "revoked"
  | "stale_state"
  | "idempotency_conflict"
  | "scope_conflict"
  | "unsupported_source"
  | "rate_limited"
  | "internal_error";

export class R1DeliveryBrokerError extends Error {
  constructor(readonly code: R1DeliveryErrorCode) {
    super(code);
    this.name = "R1DeliveryBrokerError";
  }
}

export interface R1DeliveryScope {
  readonly projectId: string;
  readonly packageId: string;
  readonly assetVersionId: string;
  readonly representationVersionId: string;
}

export interface R1DeliveryStreamRequest {
  readonly scope: R1DeliveryScope;
  readonly start: number;
  /** `undefined` or a valid end beyond EOF means through the final byte. */
  readonly endExclusive?: number;
  /** The dedicated HTTP broker supplies its request-abort signal here. */
  readonly signal?: AbortSignal;
}

/** This is the only value an HTTP broker may return to a caller. */
export interface R1DeliveryChunk {
  readonly start: number;
  readonly endExclusive: number;
  readonly totalBytes: number;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  /** Infrastructure-only signal for stopping an HTTP stream after revoke. */
  readonly abortSignal: AbortSignal;
}

interface R1DeliveryStorageDescriptor {
  /** Exact canonical scope derived by request-bound server authorization. */
  readonly effectiveScope: R1DeliveryScope;
  readonly bucket: "client-uploads";
  readonly privateStorageLocator: string;
  readonly storageGeneration: string;
  readonly totalBytes: number;
  /** Server-derived digest for the immutable representation bytes. */
  readonly sha256: string;
  readonly mediaType: string;
}

/**
 * Implemented by the private data plane only. Each invocation must call a
 * request-bound server authorization that derives actor, organization,
 * project, package and the exact immutable asset/representation pair.
 * Return the canonical authorized selectors as the descriptor's effectiveScope.
 */
export interface R1DeliveryAuthorizer {
  authorize(
    scope: R1DeliveryScope,
    signal: AbortSignal,
  ): Promise<R1DeliveryStorageDescriptor>;
}

export interface R1DeliveryRevocationWatch {
  readonly signal: AbortSignal;
  close(): void;
}

/**
 * The dedicated broker subscribes once per stream, after initial authorization,
 * using the returned effective scope. A polling implementation is insufficient:
 * an already open stream
 * must stop before it emits a later bounded chunk.
 */
export interface R1DeliveryRevocationWatcher {
  watch(scope: R1DeliveryScope): R1DeliveryRevocationWatch;
}

/**
 * A private storage adapter. It is deliberately not Supabase's browser SDK and
 * has no signed-URL method. The implementation must honour `signal`.
 */
export interface R1DeliveryPrivateStorage {
  readRange(input: {
    readonly bucket: "client-uploads";
    readonly privateStorageLocator: string;
    /** Conditional read: reject if this exact immutable generation changed. */
    readonly expectedStorageGeneration: string;
    readonly start: number;
    readonly endExclusive: number;
    readonly signal: AbortSignal;
  }): Promise<Uint8Array>;
}

function openRevocationWatch(
  watcher: R1DeliveryRevocationWatcher,
  scope: R1DeliveryScope,
): R1DeliveryRevocationWatch {
  try {
    const watch = watcher.watch(scope);
    if (
      !watch
      || typeof watch.close !== "function"
      || !watch.signal
      || typeof watch.signal.aborted !== "boolean"
      || typeof watch.signal.addEventListener !== "function"
    ) {
      throw new Error("invalid_r1_delivery_revocation_watch");
    }
    return watch;
  } catch (error) {
    throw sanitizeDeliveryError(error);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function assertR1DeliveryScope(scope: R1DeliveryScope): void {
  for (const value of [
    scope.projectId,
    scope.packageId,
    scope.assetVersionId,
    scope.representationVersionId,
  ]) {
    if (!UUID_PATTERN.test(value)) throw new R1DeliveryBrokerError("validation_failed");
  }
}

function assertDescriptor(value: R1DeliveryStorageDescriptor): void {
  try {
    assertR1DeliveryScope(value.effectiveScope);
  } catch {
    throw new R1DeliveryBrokerError("internal_error");
  }
  if (
    value.bucket !== "client-uploads"
    || typeof value.privateStorageLocator !== "string"
    || value.privateStorageLocator.length < 1
    || value.privateStorageLocator.length > 2048
    || /[\u0000-\u001f\u007f]/.test(value.privateStorageLocator)
    || typeof value.storageGeneration !== "string"
    || !/^[A-Za-z0-9._:-]{1,512}$/.test(value.storageGeneration)
    || !Number.isSafeInteger(value.totalBytes)
    || value.totalBytes < 1
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.mediaType !== "string"
    || value.mediaType.length < 1
    || value.mediaType.length > 255
    || !MEDIA_TYPE_PATTERN.test(value.mediaType)
  ) {
    throw new R1DeliveryBrokerError("internal_error");
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new R1DeliveryBrokerError("revoked");
}

const SAFE_POLICY_ERROR_CODES = new Set([
  "unauthenticated",
  "identity_unverified",
  "forbidden",
  "not_found",
  "expired",
  "revoked",
  "stale_state",
  "idempotency_conflict",
  "scope_conflict",
  "unsupported_source",
  "validation_failed",
  "rate_limited",
  "internal_error",
]);

function sanitizeDeliveryError(error: unknown): R1DeliveryBrokerError {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
  return new R1DeliveryBrokerError(
    typeof code === "string" && SAFE_POLICY_ERROR_CODES.has(code)
      ? code as R1DeliveryErrorCode
      : "internal_error",
  );
}

class R1DeliveryChunkDeadline {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly deadline: Promise<never>;
  private readonly listeners: Array<readonly [AbortSignal, () => void]> = [];
  private readonly timeout: ReturnType<typeof setTimeout>;
  private error: R1DeliveryBrokerError | null = null;
  private rejectDeadline!: (reason: R1DeliveryBrokerError) => void;

  constructor(signals: readonly (AbortSignal | undefined)[]) {
    this.signal = this.controller.signal;
    this.deadline = new Promise<never>((_resolve, reject) => {
      this.rejectDeadline = reject;
    });
    for (const signal of signals) {
      if (!signal) continue;
      const abort = () => this.fail("revoked");
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        this.listeners.push([signal, abort]);
      }
    }
    this.timeout = setTimeout(() => this.fail("internal_error"), R1_DELIVERY_RECHECK_MS);
  }

  private fail(code: R1DeliveryErrorCode): void {
    if (this.error) return;
    this.error = new R1DeliveryBrokerError(code);
    this.controller.abort();
    this.rejectDeadline(this.error);
  }

  assertCurrent(): void {
    if (this.error) throw this.error;
  }

  async run<T>(work: Promise<T>): Promise<T> {
    try {
      const value = await Promise.race([work, this.deadline]);
      this.assertCurrent();
      return value;
    } catch (error) {
      if (this.error) throw this.error;
      throw error;
    }
  }

  close(): void {
    clearTimeout(this.timeout);
    for (const [signal, abort] of this.listeners) signal.removeEventListener("abort", abort);
  }
}

async function authorizeChunk(input: {
  readonly authorizer: R1DeliveryAuthorizer;
  readonly scope: R1DeliveryScope;
  readonly deadline: R1DeliveryChunkDeadline;
}): Promise<R1DeliveryStorageDescriptor> {
  try {
    return await input.deadline.run(input.authorizer.authorize(input.scope, input.deadline.signal));
  } catch (error) {
    throw sanitizeDeliveryError(error);
  }
}

function rangeEndExclusive(input: {
  readonly start: number;
  readonly totalBytes: number;
}): number {
  if (
    !Number.isSafeInteger(input.start)
    || !Number.isSafeInteger(input.totalBytes)
    || input.start < 0
    || input.start >= input.totalBytes
  ) {
    throw new R1DeliveryBrokerError("validation_failed");
  }
  return Math.min(input.totalBytes, input.start + R1_DELIVERY_CHUNK_BYTES);
}

async function boundedStorageRead(input: {
  readonly storage: R1DeliveryPrivateStorage;
  readonly descriptor: R1DeliveryStorageDescriptor;
  readonly start: number;
  readonly endExclusive: number;
  readonly deadline: R1DeliveryChunkDeadline;
}): Promise<Uint8Array> {
  try {
    return await input.deadline.run(input.storage.readRange({
      bucket: input.descriptor.bucket,
      privateStorageLocator: input.descriptor.privateStorageLocator,
      expectedStorageGeneration: input.descriptor.storageGeneration,
      start: input.start,
      endExclusive: input.endExclusive,
      signal: input.deadline.signal,
    }));
  } catch (error) {
    try {
      input.deadline.assertCurrent();
    } catch (deadlineError) {
      throw sanitizeDeliveryError(deadlineError);
    }
    throw sanitizeDeliveryError(error);
  }
}

/**
 * Stateful only for one HTTP stream. It deliberately re-authorizes each
 * bounded chunk, so membership/grant revocation stops later bytes without
 * promising to retract bytes already in flight.
 */
export class R1PrivateDeliveryBroker {
  constructor(
    private readonly authorizer: R1DeliveryAuthorizer,
    private readonly storage: R1DeliveryPrivateStorage,
    private readonly revocations: R1DeliveryRevocationWatcher,
  ) {}

  async *stream(input: R1DeliveryStreamRequest): AsyncGenerator<R1DeliveryChunk> {
    const requestedScope = { ...input.scope };
    assertR1DeliveryScope(requestedScope);
    if (!Number.isSafeInteger(input.start) || input.start < 0) {
      throw new R1DeliveryBrokerError("validation_failed");
    }
    if (
      input.endExclusive !== undefined
      && (!Number.isSafeInteger(input.endExclusive) || input.endExclusive <= input.start)
    ) {
      throw new R1DeliveryBrokerError("validation_failed");
    }

    let cursor = input.start;
    const requestedEnd = input.endExclusive;
    assertNotAborted(input.signal);
    const initialDeadline = new R1DeliveryChunkDeadline([input.signal]);
    let expected: R1DeliveryStorageDescriptor;
    try {
      const descriptor = await authorizeChunk({
        authorizer: this.authorizer,
        scope: { ...requestedScope },
        deadline: initialDeadline,
      });
      assertDescriptor(descriptor);
      initialDeadline.assertCurrent();
      if (
        descriptor.effectiveScope.projectId.toLowerCase() !== requestedScope.projectId.toLowerCase()
        || descriptor.effectiveScope.packageId.toLowerCase() !== requestedScope.packageId.toLowerCase()
        || descriptor.effectiveScope.assetVersionId.toLowerCase() !== requestedScope.assetVersionId.toLowerCase()
        || descriptor.effectiveScope.representationVersionId.toLowerCase() !== requestedScope.representationVersionId.toLowerCase()
      ) {
        throw new R1DeliveryBrokerError("internal_error");
      }
      expected = { ...descriptor, effectiveScope: { ...descriptor.effectiveScope } };
    } finally {
      initialDeadline.close();
    }
    if (cursor >= expected.totalBytes) {
      throw new R1DeliveryBrokerError("validation_failed");
    }
    const requestedEndExclusive = Math.min(requestedEnd ?? expected.totalBytes, expected.totalBytes);
    assertNotAborted(input.signal);
    const revocationWatch = openRevocationWatch(this.revocations, { ...expected.effectiveScope });

    try {
      while (true) {
        assertNotAborted(input.signal);
        assertNotAborted(revocationWatch.signal);
        const deadline = new R1DeliveryChunkDeadline([input.signal, revocationWatch.signal]);
        let chunk: R1DeliveryChunk;
        try {
          const descriptor = await authorizeChunk({
            authorizer: this.authorizer,
            // Recheck after subscribing so a revoke before the watch opened
            // cannot be missed before the first storage read.
            scope: { ...expected.effectiveScope },
            deadline,
          });
          assertDescriptor(descriptor);
          deadline.assertCurrent();
          if (
            descriptor.totalBytes !== expected.totalBytes
            || descriptor.sha256 !== expected.sha256
            || descriptor.privateStorageLocator !== expected.privateStorageLocator
            || descriptor.storageGeneration !== expected.storageGeneration
            || descriptor.effectiveScope.projectId !== expected.effectiveScope.projectId
            || descriptor.effectiveScope.packageId !== expected.effectiveScope.packageId
            || descriptor.effectiveScope.assetVersionId !== expected.effectiveScope.assetVersionId
            || descriptor.effectiveScope.representationVersionId !== expected.effectiveScope.representationVersionId
          ) {
            throw new R1DeliveryBrokerError("internal_error");
          }
          const endExclusive = Math.min(rangeEndExclusive({
            start: cursor,
            totalBytes: descriptor.totalBytes,
          }), requestedEndExclusive);
          const bytes = await boundedStorageRead({
            storage: this.storage,
            descriptor,
            start: cursor,
            endExclusive,
            deadline,
          });
          if (bytes.byteLength !== endExclusive - cursor) {
            throw new R1DeliveryBrokerError("internal_error");
          }
          deadline.assertCurrent();
          chunk = {
            start: cursor,
            endExclusive,
            totalBytes: descriptor.totalBytes,
            mediaType: descriptor.mediaType,
            bytes,
            abortSignal: revocationWatch.signal,
          };
        } finally {
          deadline.close();
        }
        yield chunk;
        cursor = chunk.endExclusive;
        if (cursor === requestedEndExclusive || cursor === chunk.totalBytes) return;
      }
    } finally {
      try {
        revocationWatch.close();
      } catch {
        // This is a best-effort unsubscribe only; never leak a provider error.
      }
    }
  }
}
