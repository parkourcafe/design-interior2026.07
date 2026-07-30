import type {
  FoundationErrorCode,
  UiError,
  UiScenario,
} from "./contracts";

const SCENARIO_ERROR: Readonly<
  Partial<Record<UiScenario, FoundationErrorCode>>
> = {
  error: "internal_error",
  stale: "stale_state",
  revoked: "revoked",
  expired: "expired",
};

export function errorForScenario(scenario: UiScenario): UiError | null {
  const code = SCENARIO_ERROR[scenario];
  if (!code) return null;
  return {
    code,
    messageKey: `projectceo.${code}`,
    retryable: code === "internal_error" || code === "stale_state",
  };
}

export function isTerminalAccessState(scenario: UiScenario): boolean {
  return scenario === "revoked" || scenario === "expired";
}
