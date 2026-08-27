export interface SecretStoreRecord {
  readonly value: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface SecretStore {
  put(input: {
    readonly ref: string;
    readonly value: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  }): Promise<void>;
  get(ref: string): Promise<SecretStoreRecord | null>;
  take(ref: string): Promise<SecretStoreRecord | null>;
  delete(ref: string): Promise<void>;
}

export class SecretStoreUnavailableError extends Error {
  constructor(readonly reason = "secret_store_not_configured") {
    super(`integration_gateway_${reason}`);
    this.name = "SecretStoreUnavailableError";
  }
}

function assertRef(ref: string): string {
  const value = ref.trim();
  if (
    value.length < 1
    || value.length > 512
    || !/^[a-z0-9][a-z0-9:_-]*$/u.test(value)
    || /(?:access|refresh)[_-]?token|client[_-]?secret|password|verifier|secret/i.test(value)
  ) {
    throw new Error("integration_gateway_secret_ref_invalid");
  }
  return value;
}

function assertExpiry(expiresAt: string): string {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new Error("integration_gateway_secret_expiry_invalid");
  }
  return parsed.toISOString();
}

function cloneValue(value: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || typeof item !== "string" || item.length > 16_384) {
      throw new Error("integration_gateway_secret_value_invalid");
    }
    result[key] = item;
  }
  return result;
}

export class FailClosedSecretStore implements SecretStore {
  async put(_input: Parameters<SecretStore["put"]>[0]): Promise<void> {
    void _input;
    throw new SecretStoreUnavailableError();
  }

  async get(_ref: string): Promise<SecretStoreRecord | null> {
    void _ref;
    throw new SecretStoreUnavailableError();
  }

  async take(_ref: string): Promise<SecretStoreRecord | null> {
    void _ref;
    throw new SecretStoreUnavailableError();
  }

  async delete(_ref: string): Promise<void> {
    void _ref;
    throw new SecretStoreUnavailableError();
  }
}

/**
 * Process-local adapter for deterministic tests and local development only.
 * It is intentionally not durable and is rejected in production.
 */
export class MemorySecretStore implements SecretStore {
  private readonly records = new Map<string, SecretStoreRecord>();

  async put(input: {
    readonly ref: string;
    readonly value: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  }): Promise<void> {
    const ref = assertRef(input.ref);
    const expiresAt = assertExpiry(input.expiresAt);
    this.records.set(ref, { value: cloneValue(input.value), expiresAt });
  }

  async get(refInput: string): Promise<SecretStoreRecord | null> {
    const ref = assertRef(refInput);
    const record = this.records.get(ref);
    if (!record) return null;
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      this.records.delete(ref);
      return null;
    }
    return { value: cloneValue(record.value), expiresAt: record.expiresAt };
  }

  async take(refInput: string): Promise<SecretStoreRecord | null> {
    const record = await this.get(refInput);
    if (record) this.records.delete(assertRef(refInput));
    return record;
  }

  async delete(refInput: string): Promise<void> {
    this.records.delete(assertRef(refInput));
  }
}

export function createSecretStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretStore {
  const adapter = env.REMHAOS_SECRET_STORE_ADAPTER?.trim().toLowerCase();
  if (adapter === "memory" && env.NODE_ENV !== "production") {
    return new MemorySecretStore();
  }
  return new FailClosedSecretStore();
}
