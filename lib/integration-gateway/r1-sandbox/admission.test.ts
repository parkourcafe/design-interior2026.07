import { afterEach, describe, expect, it, vi } from "vitest";
import { assertHostAdmission, observeLocalHost, type HostObservation } from "./admission";
import * as transport from "./docker";
afterEach(() => vi.restoreAllMocks());
const GiB = 1024 ** 3;
const host: HostObservation = { daemonId: "fixture", bootId: "fixture", at: 1000, totalBytes: 4 * GiB, availableBytes: 3 * GiB,
  serviceEnvelopes: [{ id: "service", limit: GiB, used: GiB / 2 }] };
describe("actual-capacity admission policy", () => {
  it("rejects an endpoint and metrics guest belonging to different daemons", async () => {
    const docker = new transport.DockerClient({ executable: "/synthetic/docker", context: "fixture" });
    vi.spyOn(docker, "command").mockResolvedValue({ code: 0, stderr: "", stdout: JSON.stringify({ id: "endpoint-daemon", os: "linux", cgroup: "2", security: ["name=seccomp,profile=builtin"] }) });
    vi.spyOn(transport, "boundedCommand").mockResolvedValue({ code: 0, stderr: "", stdout: "different-guest-daemon\n" });
    await expect(observeLocalHost(docker, "/synthetic/colima", "guest")).rejects.toThrow("sandbox_metrics_daemon_mismatch");
    expect(vi.mocked(docker.command).mock.calls.every(([args]) => args[0] !== "create")).toBe(true);
  });
  it("charges future headroom rather than double counting used service/tmpfs memory", () => {
    expect(() => assertHostAdmission({ ...host, availableBytes: 1.75 * GiB }, 1000)).not.toThrow();
    expect(() => assertHostAdmission({ ...host, availableBytes: 1.75 * GiB - 1 }, 1000)).toThrow("sandbox_capacity_unavailable");
  });
  it("fails closed for stale observations, unknown service limits and insufficient total envelopes", () => {
    expect(() => assertHostAdmission(host, 3001)).toThrow("sandbox_metrics_stale");
    expect(() => assertHostAdmission({ ...host, serviceEnvelopes: [{ id: "pg", limit: 0, used: 1 }] }, 1000)).toThrow("sandbox_service_envelope_unknown");
    expect(() => assertHostAdmission({ ...host, serviceEnvelopes: [{ id: "pg", limit: 3 * GiB, used: 3 * GiB }] }, 1000)).toThrow("sandbox_capacity_unavailable");
  });
});
