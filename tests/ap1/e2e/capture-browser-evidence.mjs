import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [origin, projectId, evidenceDir] = process.argv.slice(2);
if (!origin?.startsWith("http://127.0.0.1:") || !projectId || !evidenceDir) {
  throw new Error("AP1_BROWSER_ARGUMENTS_INVALID");
}

const chrome = process.env.AP1_CHROME_PATH
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const roles = ["owner", "architect", "builder", "client"];

async function waitForFile(file, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readFile(file, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("AP1_BROWSER_DEVTOOLS_NOT_READY");
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let sequence = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of events.get(message.method) ?? []) listener(message.params);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    ready,
    on(method, listener) {
      const listeners = events.get(method) ?? [];
      listeners.push(listener);
      events.set(method, listeners);
    },
    call(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function cookiesFromJar(role) {
  const jar = await readFile(path.join(evidenceDir, `${role}.cookies`), "utf8");
  return jar.split("\n")
    .map((line) => line.startsWith("#HttpOnly_") ? line.slice("#HttpOnly_".length) : line)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const fields = line.split("\t");
      return { name: fields[5], value: fields[6], url: origin };
    });
}

async function capture(role, viewport, suffix) {
  const profile = await mkdtemp(path.join(os.tmpdir(), `archidom-ap1-chrome-${role}-`));
  const processHandle = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  try {
    const activePort = await waitForFile(path.join(profile, "DevToolsActivePort"));
    const [port] = activePort.trim().split("\n");
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("AP1_BROWSER_PAGE_TARGET_MISSING");
    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const errors = [];
    cdp.on("Runtime.exceptionThrown", (event) => errors.push(event.exceptionDetails?.text ?? "exception"));
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error" || event.type === "assert") errors.push(event.type);
    });
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Network.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await cdp.call("Network.setCookies", { cookies: await cookiesFromJar(role) });
    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.call("Page.navigate", {
      url: `${origin}/dashboard/projectceo/projects/${projectId}`,
    });
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    const state = await cdp.call("Runtime.evaluate", {
      expression: "({url:location.href,text:document.body.innerText})",
      returnByValue: true,
    });
    const value = state.result.value;
    if (!value.url.includes(`/dashboard/projectceo/projects/${projectId}`)) {
      throw new Error(`AP1_BROWSER_AUTH_REDIRECT role=${role}`);
    }
    if (!value.text.includes("Kora Food Hall") || !/1.?800/.test(value.text)) {
      throw new Error(`AP1_BROWSER_WORKSPACE_CONTENT role=${role}`);
    }
    if (errors.length > 0) throw new Error(`AP1_BROWSER_CONSOLE role=${role}`);
    const screenshot = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(path.join(evidenceDir, `browser-${role}-${suffix}.png`), screenshot.data, "base64");
    cdp.close();
  } finally {
    processHandle.kill("SIGTERM");
    await new Promise((resolve) => processHandle.once("exit", resolve));
    await rm(profile, { recursive: true, force: true });
  }
}

await mkdir(evidenceDir, { recursive: true });
for (const role of roles) {
  await capture(role, { width: 1440, height: 1000, mobile: false }, "desktop");
}
await capture("owner", { width: 390, height: 844, mobile: true }, "mobile");
console.log("AP1_AUTHENTICATED_BROWSER_QA_OK roles=4 desktop=4 mobile=1 console_errors=0");
