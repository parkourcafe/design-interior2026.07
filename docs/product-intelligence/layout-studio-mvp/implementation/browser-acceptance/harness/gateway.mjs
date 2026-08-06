// Minimal stand-in for the Kong gateway used by a real Supabase deployment.
// Routing only: it rewrites /auth/v1/* to the locally built GoTrue server and
// forwards the request untouched. It performs no authentication logic of its
// own -- every token, session and user record is produced by the real GoTrue
// binary built from github.com/supabase/auth.
import http from "node:http";

const GATEWAY_PORT = 54321;
const GOTRUE_ORIGIN = "http://127.0.0.1:9999";

const server = http.createServer((req, res) => {
  if (!req.url.startsWith("/auth/v1/")) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: "not_routed",
      message: "Only /auth/v1/* is routed in this disposable harness. "
        + "PostgREST/Storage/Realtime are intentionally absent.",
    }));
    return;
  }

  const upstreamPath = req.url.replace("/auth/v1", "");
  const upstream = new URL(upstreamPath, GOTRUE_ORIGIN);
  const headers = { ...req.headers, host: upstream.host };

  const proxied = http.request(
    { hostname: upstream.hostname, port: upstream.port, path: upstream.pathname + upstream.search, method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  proxied.on("error", (error) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream_unreachable", message: error.message }));
  });
  req.pipe(proxied);
});

server.listen(GATEWAY_PORT, "127.0.0.1", () => {
  process.stdout.write(`gateway listening on http://127.0.0.1:${GATEWAY_PORT} -> ${GOTRUE_ORIGIN}\n`);
});
