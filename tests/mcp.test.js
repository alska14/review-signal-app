// MCP(stdio)와 로컬 HTTP API 시험
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const { spawnSync, spawn } = require("node:child_process");
const server = path.join(__dirname, "..", "mcp", "server.mjs");

function rpc(messages) {
  const input = messages.map(m => typeof m === "string" ? m : JSON.stringify(m)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [server], { input, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").map(l => JSON.parse(l));
}
const SRC = "B#2 값 0.96852454\nC#3 값 4.00000\n허용 오차 ±0.5";
const OUT = "B#2 0.9685\nC#3 4.00000\n허용 오차 0.5 — 모두 완료";

test("MCP: 핸드셰이크, 도구 6개, 프롬프트, 이상한 입력", () => {
  const out = rpc([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "없는도구" } },
    { jsonrpc: "2.0", id: 4, method: "server/discover" },
    [{ jsonrpc: "2.0", id: 10, method: "ping" }],
    { jsonrpc: "2.0", id: 5, method: "prompts/list" },
    { jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: "verify-completion", arguments: { requirement: SRC, result: OUT } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "constructor" } },
    "not json"
  ]);
  assert.equal(out.length, 9); // 알림은 응답 없음, 깨진 줄·배치는 오류 응답
  const byId = Object.fromEntries(out.filter(o => o.id !== null).map(o => [o.id, o]));
  assert.equal(byId[1].result.serverInfo.name, "review-signal");
  assert.equal(byId[1].result.protocolVersion, "2024-11-05");
  assert.deepEqual(byId[2].result.tools.map(t => t.name).sort(), ["build_review_prompt", "check_against_source", "paper_models", "parse_review_json", "score_review_signal", "verify_completion"]);
  assert.ok(byId[3].error);
  assert.ok(byId[7].error, "constructor 같은 이름을 도구로 실행하면 안 된다");
  assert.equal(byId[4].error.code, -32601, "server/discover 는 구현하지 않아 클라이언트가 initialize 로 돌아가게 한다");
  assert.ok(out.some(o => o.id === null && o.error && o.error.code === -32600), "배치는 오류로 응답");
  assert.equal(byId[5].result.prompts[0].name, "verify-completion");
  assert.match(byId[6].result.messages[0].content.text, /소수 자릿수 손실/);
  assert.equal(out[out.length - 1].error.code, -32700);
});

test("MCP: 모르는 프로토콜 버전을 보내면 지원하는 버전으로 응답", () => {
  const out = rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "bogus-1" } }]);
  assert.equal(out[0].result.protocolVersion, "2025-11-25");
});

test("MCP: verify_completion 이 자동 대조·프롬프트·다음 단계를 한 번에 돌려준다", () => {
  const out = rpc([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_completion", arguments: { requirement: SRC, result: OUT } } }]);
  const v = JSON.parse(out[0].result.content[0].text);
  const types = v.autoCheck.findings.map(f => f.type);
  assert.ok(types.includes("소수 자릿수 손실"));
  assert.ok(types.includes("기호 누락"));
  assert.equal(v.autoSignal.needs_review, true);
  assert.match(v.reviewPrompt, /결과는 수정하지 마라/);
  assert.equal(v.nextSteps.length, 4);
  assert.match(v.limits, /의미/);
});

test("MCP: 점수 계산 end-to-end(파싱 → 실제 결과 채움 → 점수)", () => {
  const parsed = JSON.parse(rpc([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "parse_review_json", arguments: { text: '{"confidence": 30, "needs_review": true, "reason_type": "specific", "brief_reason": "x"}', reviewer: "other" } } }])[0].result.content[0].text);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].reviewer, "other");
  const records = [{ ...parsed.records[0], actual: "wrong" }, { requested: "no", reason: "none", actual: "correct", confidence: 90 }];
  const s = JSON.parse(rpc([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "score_review_signal", arguments: { records } } }])[0].result.content[0].text);
  assert.equal(s.counts.tp, 1);
  assert.equal(s.counts.tn, 1);
  assert.equal(s.balancedAccuracy, 1);
  assert.equal(s.byReviewer.other.used, 1);
  const withAuto = JSON.parse(rpc([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "score_review_signal", arguments: { records: [...records, { requested: "yes", reason: "specific", actual: "correct", reviewer: "auto" }] } } }])[0].result.content[0].text);
  assert.equal(withAuto.counts.fp, 0, "자동 대조 기록은 대표 점수에 들어가지 않는다");
  assert.equal(withAuto.byReviewer.auto.used, 1);
});

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { "content-type": "application/json" } }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, json: d ? JSON.parse(d) : null }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("HTTP API: /health, /api/verify, 잘못된 입력", async () => {
  const child = spawn(process.execPath, [server, "--http", "0"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = "";
      child.stderr.on("data", c => { buf += c; const m = buf.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(Number(m[1])); });
      child.on("exit", () => reject(new Error("서버가 바로 종료됨: " + buf)));
      setTimeout(() => reject(new Error("시작 시간 초과")), 5000);
    });
    assert.equal((await request(port, "GET", "/health")).json.ok, true);
    const v = await request(port, "POST", "/api/verify", { requirement: SRC, result: OUT });
    assert.equal(v.status, 200);
    assert.ok(v.json.autoCheck.findings.length >= 2);
    assert.equal((await request(port, "POST", "/api/verify", "깨진 json")).status, 400);
    assert.equal((await request(port, "GET", "/api/verify")).status, 405);
    assert.equal((await request(port, "GET", "/nothing")).status, 404);
    const s = await request(port, "POST", "/api/score", { lines: "예, 검산 부족, 오답;아니오, 정답" });
    assert.equal(s.json.counts.tp, 1);
    assert.equal((await request(port, "GET", "/api/models")).json.models.length, 11);
    // 다른 호스트 이름으로 들어오는 요청(DNS 리바인딩)은 막는다
    const evil = await new Promise((resolve, reject) => { const rq = http.request({ host: "127.0.0.1", port, path: "/health", headers: { host: "evil.example.com" } }, (res) => { res.resume(); resolve(res.statusCode); }); rq.on("error", reject); rq.end(); });
    assert.equal(evil, 403);
  } finally { child.kill(); }
});

test("HTTP: 잘못된 포트 인자와 이미 쓰는 포트는 친절한 오류로 끝난다", async () => {
  const r = spawnSync(process.execPath, [server, "--http", "abc"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /포트는 0~65535/);
  const first = spawn(process.execPath, [server, "--http", "0"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => { let b = ""; first.stderr.on("data", c => { b += c; const m = b.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(Number(m[1])); }); setTimeout(() => reject(new Error("시간 초과")), 5000); });
    const second = spawnSync(process.execPath, [server, "--http", String(port)], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /이미 쓰고 있습니다/);
  } finally { first.kill(); }
});
