#!/usr/bin/env node
// 개발용 키 발급 서버: 이 컴퓨터(127.0.0.1)에서만 열리고, 메일은 실제로 보내지 않고 우편함(/dev/outbox)에 쌓는다.
// node keys/dev-server.mjs [포트]
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createService, devMailer, memoryStore } from "./service.mjs";
import { createHandlers } from "./handlers.mjs";

export function startDevServer({ port = 8788, mailDomainExists = async () => true, now } = {}) {
  const mailer = devMailer();
  let address = "http://127.0.0.1:" + port;
  const service = createService({ store: memoryStore(), mailer, mailDomainExists, now, baseUrl: () => address });
  const handle = createHandlers(service, { allowedOrigins: ["http://127.0.0.1:8765", "https://alska14.github.io"] });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/dev/outbox") { res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); return res.end(JSON.stringify(mailer.outbox)); }
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 100_000) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(c); });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "JSON 해석 실패" })); }
      try {
        const r = await handle({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: req.headers, ip: req.socket.remoteAddress });
        if (r.html) { res.writeHead(r.status, { "content-type": "text/html; charset=utf-8" }); return res.end(r.html); }
        res.writeHead(r.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...r.headers });
        res.end(r.body === null ? "" : JSON.stringify(r.body));
      } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "서버 오류" })); }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => { address = "http://127.0.0.1:" + server.address().port; resolve({ server, mailer, service, url: address }); }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startDevServer({ port: Number(process.argv[2]) || 8788 }).then((s) => console.error("키 발급 개발 서버: " + s.url + " (메일은 /dev/outbox 에 쌓임)"));
}
