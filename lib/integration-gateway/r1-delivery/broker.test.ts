import { describe, expect, it, vi } from "vitest";
import {
  R1_DELIVERY_CHUNK_BYTES,
  R1_DELIVERY_RECHECK_MS,
  R1DeliveryBrokerError,
  R1PrivateDeliveryBroker,
  type R1DeliveryAuthorizer,
  type R1DeliveryPrivateStorage,
  type R1DeliveryRevocationWatcher,
} from "./broker";

const scope = {
  projectId: "11111111-1111-4111-8111-111111111111",
  packageId: "22222222-2222-4222-8222-222222222222",
  assetVersionId: "33333333-3333-4333-8333-333333333333",
  representationVersionId: "44444444-4444-4444-8444-444444444444",
} as const;

function authorizer(totalBytes: number): R1DeliveryAuthorizer {
  return {
    authorize: vi.fn(async () => ({
      bucket: "client-uploads" as const,
      privateStorageLocator: "private/r1/opaque-locator",
      storageGeneration: "generation-1",
      totalBytes,
      sha256: "a".repeat(64),
      mediaType: "application/pdf",
    })),
  };
}

function revocations(): {
  readonly controller: AbortController;
  readonly watcher: R1DeliveryRevocationWatcher;
  readonly close: ReturnType<typeof vi.fn>;
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
    expect(policy.authorize).toHaveBeenCalledTimes(2);
    expect(policy.authorize).toHaveBeenNthCalledWith(1, scope, expect.any(AbortSignal));
    expect(policy.authorize).toHaveBeenNthCalledWith(2, scope, expect.any(AbortSignal));
    expect(privateStorage.readRange).toHaveBeenCalledTimes(2);
    expect(privateStorage.readRange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedStorageGeneration: "generation-1",
    }));
    expect(JSON.stringify(chunks)).not.toContain("privateStorageLocator");
    expect(JSON.stringify(chunks)).not.toContain("opaque-locator");
  });

  it("stops before a later chunk when the request-bound authorization is revoked", async () => {
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce({
          bucket: "client-uploads",
          privateStorageLocator: "private/r1/first",
          storageGeneration: "generation-1",
          totalBytes: R1_DELIVERY_CHUNK_BYTES + 1,
          sha256: "a".repeat(64),
          mediaType: "application/pdf",
        })
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
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce({
          bucket: "client-uploads",
          privateStorageLocator: "private/r1/original",
          storageGeneration: "generation-1",
          totalBytes: R1_DELIVERY_CHUNK_BYTES + 1,
          sha256: "a".repeat(64),
          mediaType: "application/pdf",
        })
        .mockResolvedValueOnce({
          bucket: "client-uploads",
          privateStorageLocator: "private/r1/replaced",
          storageGeneration: "generation-1",
          totalBytes: R1_DELIVERY_CHUNK_BYTES + 1,
          sha256: "b".repeat(64),
          mediaType: "application/pdf",
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
    const policy: R1DeliveryAuthorizer = {
      authorize: vi.fn()
        .mockResolvedValueOnce({
          bucket: "client-uploads",
          privateStorageLocator: "private/r1/stable",
          storageGeneration: "generation-1",
          totalBytes: R1_DELIVERY_CHUNK_BYTES + 1,
          sha256: "a".repeat(64),
          mediaType: "application/pdf",
        })
        .mockResolvedValueOnce({
          bucket: "client-uploads",
          privateStorageLocator: "private/r1/stable",
          storageGeneration: "generation-2",
          totalBytes: R1_DELIVERY_CHUNK_BYTES + 1,
          sha256: "a".repeat(64),
          mediaType: "application/pdf",
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
      const outcome = collect(broker(policy, storage()).stream({ scope, start: 0 })).then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(R1_DELIVERY_RECHECK_MS);
      await expect(outcome).resolves.toMatchObject({ code: "internal_error" });
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
    await expect(collect(broker(policy, storage()).stream({
      scope: { ...scope, representationVersionId: "not-a-uuid" },
      start: 0,
    }))).rejects.toMatchObject({ code: "validation_failed" });
    expect(policy.authorize).not.toHaveBeenCalled();
  });
});
