const PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIntegrationProviderCode(value: string): boolean {
  return PROVIDER_CODE_PATTERN.test(value);
}

export function assertOpaqueUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`remhaos.integration.invalid_${field}`);
  }
  return value;
}
