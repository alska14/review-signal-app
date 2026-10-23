// 요청 처리기(서버 종류와 무관): 개발 서버와 서버리스 래퍼가 같이 쓴다.
// 경로: POST /keys/request, GET|POST /keys/verify, POST /v1/verify|check|score (Authorization: Bearer 키 필요), GET /health
import { verifyTool, checkTool, scoreTool } from "../mcp/server.mjs";

export function createHandlers(service, { allowedOrigins = ["https://alska14.github.io"] } = {}) {
  const V1 = { "/v1/verify": verifyTool, "/v1/check": checkTool, "/v1/score": scoreTool };
  const json = (status, body, headers) => ({ status, body, headers: headers || {} });
  const html = (status, text) => ({ status, html: text });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  return async function handle({ method = "GET", path = "/", query = {}, body = {}, headers = {}, ip = "unknown" }) {
    const origin = headers.origin || headers.Origin;
    const cors = origin && allowedOrigins.includes(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" } : {};
    const done = (r) => ({ ...r, headers: { ...(r.headers || {}), ...cors } });
    if (method === "OPTIONS") return done(json(204, null));
    if (method === "GET" && path === "/health") return done(json(200, { ok: true, keys: true }));
    if (path === "/keys/request") {
      if (method !== "POST") return done(json(405, { ok: false, error: "POST 로 보내세요." }));
      const r = await service.requestKey(body && body.email, ip);
      return done(json(r.status, r.body));
    }
    if (path === "/keys/verify") {
      const token = method === "GET" ? query.token : body && body.token;
      const r = await service.verify(token);
      if (method === "GET") {
        const page = r.body.ok
          ? "<h1>API 키가 발급됐습니다</h1><p>이 키는 지금 한 번만 보입니다. 안전한 곳에 저장하세요.</p><pre style=\"word-break:break-all;white-space:pre-wrap\">" + esc(r.body.apiKey) + "</pre>"
          : "<h1>발급하지 못했습니다</h1><p>" + esc(r.body.error) + "</p>";
        return html(r.status, "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>API 키</title><body style=\"font-family:sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem\">" + page);
      }
      return done(json(r.status, r.body));
    }
    const fn = Object.prototype.hasOwnProperty.call(V1, path) ? V1[path] : null;
    if (fn) {
      if (method !== "POST") return done(json(405, { error: "POST 로 보내세요." }));
      const who = await service.authenticate(headers.authorization || headers.Authorization);
      if (!who) return done(json(401, { error: "API 키가 필요합니다(Authorization: Bearer rs_...)." }));
      return done(json(200, fn(body && typeof body === "object" ? body : {})));
    }
    return done(json(404, { error: "없는 경로입니다." }));
  };
}
