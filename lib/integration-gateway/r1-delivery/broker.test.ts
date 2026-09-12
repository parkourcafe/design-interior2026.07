import { describe, expect, it, vi } from "vitest";
import {
  R1_DELIVERY_CHUNK_BYTES,
  R1_DELIVERY_RECHECK_MS,
  R1DeliveryBrokerError,
  R1PrivateDeliveryBroker,
  type R1DeliveryAuthorizer,
  type R1DeliveryPrivateStorage,
  type R1DeliveryRevocationWatcher,
  type R1DeliveryScope,
} from "./broker";

const scope = {
  projectId: "11111111-1111-4111-8111-111111111111",
  packageId: "22222222-2222-4222-8222-222222222222",
  assetVersionId: "33333333-3333-4333-8333-333333333333",
  representationVersionId: "44444444-4444-4444-8444-444444444444",
} as const;

function descriptor(totalBytes: number, effectiveScope: R1DeliveryScope = scope) {
  return {
    effectiveScope,
    bucket: "client-uploads" as const,
    privateStorageLocator: "private/r1/opaque-locator",
    storageGeneration: "generation-1",
    totalBytes,
    sha256: "a".repeat(64),
    mediaType: "application/pdf",
  };
}

function authorizer(totalBytes: number, effectiveScope: R1DeliveryScope = scope): R1DeliveryAuthorizer {
  return {
    authorize: vi.fn(async () => descriptor(totalBytes, effectiveScope)),
  };
}

function revocations(): {
  readonly controller: AbortController;
  readonly watcher: R1DeliveryRevocationWatcher;
  readonly close: ReturnType<typeof vi.fn<() => void>>;
} {
  const controller = new AbortController();
  const close = vi.fn();
  return {
    controller,
    close,
    watcher: {
      watch: vi.fn(() => ({ signal: controller.signal, close })),
    },
  };
}

function broker(
  policy: R1DeliveryAuthorizer,
  privateStorage: R1DeliveryPrivateStorage,
  watcher = revocations().watcher,
): R1PrivateDeliveryBroker {
  return new R1PrivateDeliveryBroker(policy, privateStorage, watcher);
}

function storage(): R1DeliveryPrivateStorage & { readonly readRange: ReturnType<typeof vi.fn> } {
  return {
    readRange: vi.fn(async ({ start, endExclusive }: { start: number; endExclusive: number }) => (
      new Uint8Array(endExclusive - start)
    )),
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of iterable) output.push(value);
  return output;
}

describe("R1 private delivery broker", () => {
  it.each(["unauthenticated", "forbidden", "not_found", "revoked"])(
    "does not allocate a private watch or read storage for an initial %s denial",
    async (code) => {
      const policy: R1DeliveryAuthorizer = {
        authorize: vi.fn().mockRejectedValue(Object.assign(new Error(code), { code })),
      };
      const privateStorage = storage();
      const session = revocations();

      await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
        .rejects.toMatchObject({ code });
      expect(policy.authorize).toHaveBeenCalledTimes(1);
      expect(session.watcher.watch).not.toHaveBeenCalled();
      expect(privateStorage.readRange).not.toHaveBeenCalled();
      expect(session.close).not.toHaveBeenCalled();
    },
  );

  it("watches the server-derived scope only after authorization and rechecks it before reading", async () => {
    const effectiveScope = { ...scope, representationVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const requestedScope = { ...effectiveScope, representationVersionId: effectiveScope.representationVersionId.toUpperCase() };
    const events: string[] = [];
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn(async () => {
        events.push("authorize");
        return descriptor(8, effectiveScope);
      }),
    };
    const session = revocations();
    vi.mocked(session.watcher.watch).mockImplementation(() => {
      events.push("watch");
      return { signal: session.controller.signal, close: session.close };
    });
    const privateStorage = storage();
    privateStorage.readRange.mockImplementation(async () => {
      events.push("read");
      return new Uint8Array(8);
    });

    await collect(broker(policy, privateStorage, session.watcher).stream({ scope: requestedScope, start: 0 }));

    expect(events).toEqual(["authorize", "watch", "authorize", "read"]);
    expect(session.watcher.watch).toHaveBeenCalledExactlyOnceWith(effectiveScope);
    expect(policy.authorize).toHaveBeenNthCalledWith(1, requestedScope, expect.any(AbortSignal));
    expect(policy.authorize).toHaveBeenNthCalledWith(2, effectiveScope, expect.any(AbortSignal));
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("catches revocation between initial authorization and subscription before reading any bytes", async () => {
    let revoked = false;
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn(async () => {
        if (revoked) throw new R1DeliveryBrokerError("revoked");
        return descriptor(8);
      }),
    };
    const session = revocations();
    vi.mocked(session.watcher.watch).mockImplementation(() => {
      // A revoke predates subscription, so its signal cannot replay the event.
      revoked = true;
      return { signal: session.controller.signal, close: session.close };
    });
    const privateStorage = storage();

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
      .rejects.toMatchObject({ code: "revoked" });
    expect(policy.authorize).toHaveBeenCalledTimes(2);
    expect(privateStorage.readRange).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("does not authorize or subscribe an already-aborted request", async () => {
    const policy = authorizer(8);
    const session = revocations();
    const request = new AbortController();
    request.abort();
    const privateStorage = storage();

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({
      scope, start: 0, signal: request.signal,
    }))).rejects.toMatchObject({ code: "revoked" });
    expect(policy.authorize).not.toHaveBeenCalled();
    expect(session.watcher.watch).not.toHaveBeenCalled();
    expect(privateStorage.readRange).not.toHaveBeenCalled();
  });

  it.each([
    { effectiveScope: { ...scope, projectId: "55555555-5555-4555-8555-555555555555" } },
    { effectiveScope: { ...scope, packageId: "55555555-5555-4555-8555-555555555555" } },
    { effectiveScope: { ...scope, assetVersionId: "55555555-5555-4555-8555-555555555555" } },
    { effectiveScope: { ...scope, representationVersionId: "55555555-5555-4555-8555-555555555555" } },
    { privateStorageLocator: "private/r1/replaced" },
    { storageGeneration: "generation-2" },
    { sha256: "b".repeat(64) },
    { totalBytes: 9 },
  ])("rejects descriptor drift after subscribing and before the first read: %o", async (change) => {
    const initial = descriptor(8);
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, ...change }),
    };
    const privateStorage = storage();
    const session = revocations();

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
      .rejects.toMatchObject({ code: "internal_error" });
    expect(policy.authorize).toHaveBeenCalledTimes(2);
    expect(privateStorage.readRange).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed server-derived scope before opening a private watch", async () => {
    const policy = authorizer(8, { ...scope, packageId: "invalid-private-scope" });
    const privateStorage = storage();
    const session = revocations();

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
      .rejects.toMatchObject({ code: "internal_error" });
    expect(session.watcher.watch).not.toHaveBeenCalled();
    expect(privateStorage.readRange).not.toHaveBeenCalled();
  });

  it.each(["projectId", "packageId", "assetVersionId", "representationVersionId"] as const)(
    "rejects an initial server scope that substitutes the requested %s",
    async (field) => {
      const effectiveScope = { ...scope, [field]: "55555555-5555-4555-8555-555555555555" };
      const policy = authorizer(8, effectiveScope);
      const privateStorage = storage();
      const session = revocations();

      await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
        .rejects.toMatchObject({ code: "internal_error" });
      expect(policy.authorize).toHaveBeenCalledTimes(1);
      expect(session.watcher.watch).not.toHaveBeenCalled();
      expect(privateStorage.readRange).not.toHaveBeenCalled();
    },
  );

  it("keeps the validated range fixed while authorization is pending", async () => {
    const request = { scope, start: 5, endExclusive: 8 };
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn(async () => {
        request.start = 8;
        request.endExclusive = Number.NaN;
        return descriptor(8);
      }),
    };
    const privateStorage = storage();

    const chunks = await collect(broker(policy, privateStorage).stream(request));

    expect(chunks.map((chunk) => [chunk.start, chunk.endExclusive])).toEqual([[5, 8]]);
    expect(privateStorage.readRange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      start: 5, endExclusive: 8,
    }));
  });

  it("closes the watch without storage reads if revocation arrives while subscribing", async () => {
    const policy = authorizer(8);
    const privateStorage = storage();
    const session = revocations();
    vi.mocked(session.watcher.watch).mockImplementation(() => {
      session.controller.abort();
      return { signal: session.controller.signal, close: session.close };
    });

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })))
      .rejects.toMatchObject({ code: "revoked" });
    expect(privateStorage.readRange).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("re-authorizes each bounded chunk and never returns a storage locator", async () => {
    const policy = authorizer(R1_DELIVERY_CHUNK_BYTES + 7);
    const privateStorage = storage();
    const chunks = await collect(broker(policy, privateStorage).stream({
      scope,
      start: 0,
    }));

    expect(chunks.map((chunk) => [chunk.start, chunk.endExclusive])).toEqual([
      [0, R1_DELIVERY_CHUNK_BYTES],
      [R1_DELIVERY_CHUNK_BYTES, R1_DELIVERY_CHUNK_BYTES + 7],
    ]);
    expect(policy.authorize).toHaveBeenCalledTimes(3);
    expect(policy.authorize).toHaveBeenNthCalledWith(1, scope, expect.any(AbortSignal));
    expect(policy.authorize).toHaveBeenNthCalledWith(2, scope, expect.any(AbortSignal));
    expect(policy.authorize).toHaveBeenNthCalledWith(3, scope, expect.any(AbortSignal));
    expect(privateStorage.readRange).toHaveBeenCalledTimes(2);
    expect(privateStorage.readRange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedStorageGeneration: "generation-1",
    }));
    expect(JSON.stringify(chunks)).not.toContain("privateStorageLocator");
    expect(JSON.stringify(chunks)).not.toContain("opaque-locator");
  });

  it("stops before a later chunk when the request-bound authorization is revoked", async () => {
    const initial = descriptor(R1_DELIVERY_CHUNK_BYTES + 1);
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(initial)
        .mockRejectedValueOnce(Object.assign(new Error("revoked"), { code: "revoked" })),
    };
    const privateStorage = storage();
    const delivery = broker(policy, privateStorage);
    const stream = delivery.stream({ scope, start: 0 });

    expect((await stream.next()).value?.bytes.byteLength).toBe(R1_DELIVERY_CHUNK_BYTES);
    await expect(stream.next()).rejects.toMatchObject({ code: "revoked" });
    expect(privateStorage.readRange).toHaveBeenCalledTimes(1);
  });

  it("rejects a re-authorized chunk if the immutable representation digest changes", async () => {
    const initial = descriptor(R1_DELIVERY_CHUNK_BYTES + 1);
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce({
          ...initial,
          privateStorageLocator: "private/r1/replaced",
          sha256: "b".repeat(64),
        }),
    };
    const privateStorage = storage();
    const delivery = broker(policy, privateStorage);
    const stream = delivery.stream({ scope, start: 0 });

    await stream.next();
    await expect(stream.next()).rejects.toMatchObject({ code: "internal_error" });
    expect(privateStorage.readRange).toHaveBeenCalledTimes(1);
  });

  it("pins storage generation as well as locator and digest for a live stream", async () => {
    const initial = descriptor(R1_DELIVERY_CHUNK_BYTES + 1);
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce({
          ...initial,
          storageGeneration: "generation-2",
        }),
    };
    const privateStorage = storage();
    const stream = broker(policy, privateStorage).stream({ scope, start: 0 });

    await stream.next();
    await expect(stream.next()).rejects.toMatchObject({ code: "internal_error" });
    expect(privateStorage.readRange).toHaveBeenCalledTimes(1);
  });

  it("sanitizes a request-bound policy failure to its stable code", async () => {
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn().mockRejectedValue(Object.assign(
        new Error("private/r1/should-not-leak"),
        { code: "forbidden", privateStorageLocator: "private/r1/should-not-leak" },
      )),
    };
    const outcome = collect(broker(policy, storage()).stream({ scope, start: 0 })).then(
      () => null,
      (error: unknown) => error,
    );

    await expect(outcome).resolves.toMatchObject({ code: "forbidden", message: "forbidden" });
    await expect(outcome).resolves.not.toHaveProperty("privateStorageLocator");
  });

  it("sanitizes decorated typed errors from both authorization and storage adapters", async () => {
    const policyFailure = Object.assign(new R1DeliveryBrokerError("forbidden"), {
      message: "private/r1/authorization-diagnostic",
      privateStorageLocator: "private/r1/authorization-diagnostic",
    });
    const denied = collect(broker({ authorize: vi.fn().mockRejectedValue(policyFailure) }, storage()).stream({
      scope,
      start: 0,
    })).then(
      () => null,
      (error: unknown) => error,
    );
    await expect(denied).resolves.toMatchObject({ code: "forbidden", message: "forbidden" });
    await expect(denied).resolves.not.toBe(policyFailure);
    await expect(denied).resolves.not.toHaveProperty("privateStorageLocator");

    const storageFailure = Object.assign(new R1DeliveryBrokerError("forbidden"), {
      message: "private/r1/storage-diagnostic",
      privateStorageLocator: "private/r1/storage-diagnostic",
    });
    const failedRead = collect(broker(authorizer(8), {
      readRange: async () => { throw storageFailure; },
    }).stream({ scope, start: 0 })).then(
      () => null,
      (error: unknown) => error,
    );
    await expect(failedRead).resolves.toMatchObject({ code: "forbidden", message: "forbidden" });
    await expect(failedRead).resolves.not.toBe(storageFailure);
    await expect(failedRead).resolves.not.toHaveProperty("privateStorageLocator");
  });

  it("caps an explicit browser Range to a single requested immutable interval", async () => {
    const policy = authorizer(R1_DELIVERY_CHUNK_BYTES * 2);
    const privateStorage = storage();
    const chunks = await collect(broker(policy, privateStorage).stream({
      scope,
      start: 5,
      endExclusive: 11,
    }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ start: 5, endExclusive: 11, totalBytes: R1_DELIVERY_CHUNK_BYTES * 2 });
    expect(privateStorage.readRange).toHaveBeenCalledWith(expect.objectContaining({ start: 5, endExclusive: 11 }));
  });

  it.each([
    { start: 0, totalBytes: 8, endExclusive: 99, intervals: [[0, 8]] },
    { start: 5, totalBytes: 8, endExclusive: Number.MAX_SAFE_INTEGER, intervals: [[5, 8]] },
    {
      start: 5,
      totalBytes: R1_DELIVERY_CHUNK_BYTES + 8,
      endExclusive: R1_DELIVERY_CHUNK_BYTES * 2,
      intervals: [[5, R1_DELIVERY_CHUNK_BYTES + 5], [R1_DELIVERY_CHUNK_BYTES + 5, R1_DELIVERY_CHUNK_BYTES + 8]],
    },
  ])("clamps a satisfiable range $start–$endExclusive to EOF $totalBytes", async ({
    start, totalBytes, endExclusive, intervals,
  }) => {
    const policy = authorizer(totalBytes);
    const privateStorage = storage();
    const chunks = await collect(broker(policy, privateStorage).stream({ scope, start, endExclusive }));

    expect(chunks.map((chunk) => [chunk.start, chunk.endExclusive])).toEqual(intervals);
    expect(chunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0)).toBe(totalBytes - start);
    expect(privateStorage.readRange.mock.calls.map(([read]) => [read.start, read.endExclusive])).toEqual(intervals);
  });

  it.each([
    { start: 8 },
    { start: 9 },
    { start: 8, endExclusive: 99 },
    { start: 9, endExclusive: 99 },
  ])("rejects a range starting at or beyond EOF: $start–$endExclusive", async (range) => {
    const privateStorage = storage();
    const session = revocations();

    await expect(collect(broker(authorizer(8), privateStorage, session.watcher).stream({ scope, ...range })))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(session.watcher.watch).not.toHaveBeenCalled();
    expect(privateStorage.readRange).not.toHaveBeenCalled();
  });

  it.each([
    { start: -1 },
    { start: 0.5 },
    { start: Number.NaN },
    { start: Number.MAX_SAFE_INTEGER + 1 },
    { start: 0, endExclusive: 0 },
    { start: 0, endExclusive: -1 },
    { start: 5, endExclusive: 5 },
    { start: 5, endExclusive: 4 },
    { start: 0, endExclusive: 1.5 },
    { start: 0, endExclusive: Number.POSITIVE_INFINITY },
    { start: 0, endExclusive: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects unsafe or empty ranges before private work: $start–$endExclusive", async (range) => {
    const policy = authorizer(8);
    const privateStorage = storage();
    const session = revocations();

    await expect(collect(broker(policy, privateStorage, session.watcher).stream({ scope, ...range })))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(policy.authorize).not.toHaveBeenCalled();
    expect(session.watcher.watch).not.toHaveBeenCalled();
    expect(privateStorage.readRange).not.toHaveBeenCalled();
  });

  it("fails closed if private storage returns a partial bounded chunk", async () => {
    const policy = authorizer(8);
    const privateStorage: R1DeliveryPrivateStorage = {
      readRange: async () => new Uint8Array(7),
    };
    await expect(collect(broker(policy, privateStorage).stream({ scope, start: 0 })))
      .rejects.toMatchObject({ code: "internal_error" });
  });

  it("stops delivery when private storage ignores the bounded deadline signal", async () => {
    vi.useFakeTimers();
    try {
      const privateStorage: R1DeliveryPrivateStorage = {
        readRange: () => new Promise<Uint8Array>(() => undefined),
      };
      const outcome = collect(broker(authorizer(8), privateStorage).stream({
        scope,
        start: 0,
      })).then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(R1_DELIVERY_RECHECK_MS);
      await expect(outcome).resolves.toMatchObject({ code: "internal_error" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops delivery when request-bound authorization ignores the deadline signal", async () => {
    vi.useFakeTimers();
    try {
      const policy: R1DeliveryAuthorizer = {
        authorize: () => new Promise(() => undefined),
      };
      const privateStorage = storage();
      const session = revocations();
      const outcome = collect(broker(policy, privateStorage, session.watcher).stream({ scope, start: 0 })).then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(R1_DELIVERY_RECHECK_MS);
      await expect(outcome).resolves.toMatchObject({ code: "internal_error" });
      expect(session.watcher.watch).not.toHaveBeenCalled();
      expect(privateStorage.readRange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an in-flight read before yielding bytes when the private revoke signal arrives", async () => {
    let storageEntered!: () => void;
    const entered = new Promise<void>((resolve) => { storageEntered = resolve; });
    const privateStorage: R1DeliveryPrivateStorage = {
      readRange: ({ signal }) => new Promise<Uint8Array>((_resolve, reject) => {
        storageEntered();
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    };
    const session = revocations();
    const outcome = collect(broker(authorizer(8), privateStorage, session.watcher).stream({
      scope,
      start: 0,
    })).then(
      () => null,
      (error: unknown) => error,
    );

    await entered;
    session.controller.abort();
    await expect(outcome).resolves.toMatchObject({ code: "revoked" });
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed exact selector before authorizing storage", async () => {
    const policy = authorizer(8);
    const privateStorage = storage();
    const session = revocations();
    await expect(collect(broker(policy, privateStorage, session.watcher).stream({
      scope: { ...scope, representationVersionId: "not-a-uuid" },
      start: 0,
    }))).rejects.toMatchObject({ code: "validation_failed" });
    expect(policy.authorize).not.toHaveBeenCalled();
    expect(session.watcher.watch).not.toHaveBeenCalled();
    expect(privateStorage.readRange).not.toHaveBeenCalled();
  });
});
