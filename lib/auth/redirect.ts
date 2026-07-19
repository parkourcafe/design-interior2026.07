const DASHBOARD_PATH = /^\/dashboard(?:\/|$|\?)/;

export function safeDashboardPath(value: string | null | undefined): string {
  return value && DASHBOARD_PATH.test(value) ? value : "/dashboard";
}
