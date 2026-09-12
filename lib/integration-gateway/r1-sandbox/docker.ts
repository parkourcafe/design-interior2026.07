import { request } from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import type { ContainerObservation } from "./profile";

export type DockerConfig = { readonly executable: string } & (
  { readonly context: string; readonly endpoint?: never } | { readonly endpoint: string; readonly context?: never }
);
export interface CommandResult { readonly code: number; readonly stdout: string; readonly stderr: string }
export class DockerClient {
  constructor(readonly config: DockerConfig) {
    const connection = config.context !== undefined
      ? /^[a-z0-9-]+$/.test(config.context) && config.endpoint === undefined
      : typeof config.endpoint === "string" && /^unix:\/\/\/[^\u0000-\u001f\u007f]+$/.test(config.endpoint);
    if (!isAbsolute(config.executable) || !connection) throw new Error("sandbox_docker_config_invalid");
  }
  command(args: readonly string[], timeoutMs = 5_000, signal?: AbortSignal): Promise<CommandResult> {
    const connection = this.config.context !== undefined ? ["--context", this.config.context] : ["--host", this.config.endpoint];
    return boundedCommand(this.config.executable, [...connection, ...args], timeoutMs, signal);
  }
  async memorySample(id: string): Promise<{ used: number; at: number }> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("sandbox_container_id_invalid");
    let endpoint = this.config.endpoint;
    if (!endpoint) {
      if (!this.config.context) throw new Error("sandbox_local_socket_required");
      const context = await this.command(["context", "inspect", this.config.context, "--format", "{{.Endpoints.docker.Host}}"], 750);
      if (context.code) throw new Error("sandbox_local_socket_required");
      endpoint = context.stdout.trim();
    }
    if (!endpoint.startsWith("unix:///")) throw new Error("sandbox_local_socket_required");
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ socketPath: endpoint.slice(7), method: "GET", path: `/containers/${id}/stats?stream=false&one-shot=true` }, response => {
        let body = ""; let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65_536) req.destroy(new Error("sandbox_stats_overflow"));
          else body += chunk.toString("utf8");
        });
        response.on("end", () => {
          clearTimeout(timer);
          if (response.statusCode === 200) resolve(body);
          else reject(new Error("sandbox_stats_unavailable"));
        });
        response.on("error", () => { clearTimeout(timer); reject(new Error("sandbox_stats_unavailable")); });
        response.on("aborted", () => { clearTimeout(timer); reject(new Error("sandbox_stats_unavailable")); });
      });
      const timer = setTimeout(() => { req.destroy(); reject(new Error("sandbox_stats_timeout")); }, 750);
      req.on("error", () => { clearTimeout(timer); reject(new Error("sandbox_stats_unavailable")); }); req.end();
    });
    const sample = JSON.parse(body) as { read: string; memory_stats: { usage: number; stats: { inactive_file?: number } } };
    const used = Math.max(0, sample.memory_stats.usage - (sample.memory_stats.stats.inactive_file ?? 0));
    const at = Date.parse(sample.read);
    if (!Number.isSafeInteger(used) || !Number.isSafeInteger(at) || used < 0 || Date.now() - at > 2_000 || Date.now() < at - 500) throw new Error("sandbox_stats_stale");
    return { used, at };
  }
  async inspect(id: string, timeoutMs = 5_000): Promise<ContainerObservation | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("sandbox_container_id_invalid");
    const result = await this.command(["inspect", "--format", '{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"User":{{json .Config.User}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"Running":{{json .State.Running}},"OOMKilled":{{json .State.OOMKilled}},"ExitCode":{{json .State.ExitCode}},"HostConfig":{{json .HostConfig}},"Mounts":{{json .Mounts}}}', id], timeoutMs);
    if (result.code !== 0) {
      if (/no such (?:object|container):/i.test(result.stderr)) return null;
      throw new Error("sandbox_inspect_unavailable");
    }
    return JSON.parse(result.stdout) as ContainerObservation;
  }
}

/** A timeout reaps the CLI only; callers must reconcile/kill the daemon-owned job. */
export function boundedCommand(executable: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("sandbox_command_aborted")); return; }
    const child = spawn(executable, args, { shell: false, env: { NODE_ENV: "production", HOME: homedir(), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = ""; let count = 0; let failed = false;
    const kill = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    const collect = (chunk: Buffer, error: boolean) => {
      count += chunk.length;
      if (count > 65_536) { kill(); return; }
      if (error) errors += chunk.toString("utf8"); else output += chunk.toString("utf8");
    };
    child.stdout.on("data", chunk => collect(chunk, false)); child.stderr.on("data", chunk => collect(chunk, true));
    child.on("error", () => { failed = true; });
    child.on("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", kill);
      if (failed) reject(new Error("sandbox_command_incomplete"));
      else resolve({ code: code ?? -1, stdout: output, stderr: errors });
    });
  });
}

export async function processGroup(pid = process.pid): Promise<number> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("sandbox_process_invalid");
  const result = await boundedCommand("/bin/ps", ["-o", "pgid=", "-p", String(pid)], 500);
  const group = Number(result.stdout.trim());
  if (result.code || !Number.isSafeInteger(group) || group < 1) throw new Error("sandbox_process_group_unknown");
  return group;
}
