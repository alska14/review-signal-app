#!/usr/bin/env node
// AI 완료 보고 점검기: MCP 서버(표준 입출력) + 로컬 HTTP API. 외부 패키지 없음, Node 18+.
//   node mcp/server.mjs                 -> MCP(stdio) 서버. Claude Code·Claude Desktop·Codex 등에 등록해 쓴다.
//   node mcp/server.mjs --http [포트]   -> 이 컴퓨터(127.0.0.1)에서만 열리는 REST API (기본 8787)
// 입력은 이 프로세스 안에서만 계산한다. 비밀값·외부 네트워크 요청 없음.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RS = require(join(here, "..", "logic.js"));
const SC = require(join(here, "..", "check.js"));
const win = {};
new Function("window", readFileSync(join(here, "..", "data_models.js"), "utf8"))(win);
const MODELS = win.PAPER_MODELS;

const NEXT_STEPS = [
  "1) autoCheck.findings 를 사용자에게 그대로 보여 준다(심각도 high 부터).",
  "2) reviewPrompt 를 결과를 만든 대화와 분리된 새 컨텍스트(서브에이전트나 다른 모델)에서 실행해 JSON 만 받는다. 결과를 고치게 하거나 정답을 알려 주지 않는다.",
  "3) 받은 JSON 을 parse_review_json 에 넣어 기록으로 바꾼다. actual(실제 결과)은 사람이 원문과 대조해 correct 또는 wrong 으로 채운다.",
  "4) 기록이 쌓이면 score_review_signal 로 균형정확도·Brier 를 계산한다."
];
const LIMITS = "autoCheck 는 글자·숫자·기호·ID·항목 수 수준의 대조입니다. 의미·계산의 옳음은 확인하지 못하며 '찾지 못함'이 '문제 없음'은 아닙니다. autoSignal 은 사람이 확인하기 전의 초기값입니다.";

const TOOLS = [
  {
    name: "verify_completion",
    description: "AI가 '완료했다'고 보고한 결과를 한 번에 점검한다. (1) 원문과 결과를 기계적으로 대조해 소수 자릿수 손실·기호 누락·숫자/ID 누락·항목 누락을 찾고, (2) 논문 방식의 재검토 프롬프트를 만들고, (3) 다음 단계 안내를 돌려준다. 결과를 만든 AI와 다른 컨텍스트에서 reviewPrompt 를 실행해 재검토를 받는 것을 권한다.",
    inputSchema: { type: "object", properties: { requirement: { type: "string", description: "요구사항 원문 또는 입력 자료" }, result: { type: "string", description: "AI의 결과와 완료 보고" } }, required: ["requirement", "result"] }
  },
  {
    name: "check_against_source",
    description: "원문과 AI 결과를 LLM 없이 기계적으로 대조한다(숫자·소수 자릿수·기호·ID·항목 수). 의미 오류는 못 잡는다.",
    inputSchema: { type: "object", properties: { source: { type: "string" }, output: { type: "string" } }, required: ["source", "output"] }
  },
  {
    name: "build_review_prompt",
    description: "논문 부록 B1의 자기 평가 프롬프트를 업무용으로 옮긴 문장을 만든다. 다른 AI 대화나 서브에이전트에 붙여 재검토만 시킬 때 쓴다.",
    inputSchema: { type: "object", properties: { requirement: { type: "string" }, result: { type: "string" } } }
  },
  {
    name: "parse_review_json",
    description: "AI가 돌려준 재검토 JSON(confidence, needs_review, reason_type, brief_reason)을 기록 형식으로 바꾼다. 실제 결과(actual)는 사람이 확인해서 채워야 한다.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, reviewer: { type: "string", enum: ["same", "other", "human", "auto"] } }, required: ["text"] }
  },
  {
    name: "score_review_signal",
    description: "재검토의 '검토 필요' 신호가 실제 오답을 얼마나 가려냈는지 계산한다(논문 3.4절: 균형정확도 = (오답 검토율 + 1 − 정답 검토율)/2, Brier). 정답 또는 오답이 0건이면 0%가 아니라 계산 불가(null). records 또는 lines 중 하나를 넣는다.",
    inputSchema: {
      type: "object",
      properties: {
        records: {
          type: "array", description: "건 하나가 한 원소",
          items: {
            type: "object",
            properties: {
              requested: { type: "string", enum: ["yes", "no"], description: "재검토가 '검토 필요'라고 했는가" },
              confidence: { type: "number", description: "재검토가 적은 확신도 0~100(선택, Brier 계산용)" },
              reviewer: { type: "string", enum: ["same", "other", "human", "auto"], description: "재검토한 쪽(기본 same)" },
              reason: { type: "string", enum: ["shortage", "specific", "none"], description: "검산 부족 / 구체적 오류 지적 / 근거 없음" },
              actual: { type: "string", enum: ["correct", "wrong"], description: "내가 확인한 실제 결과" }
            },
            required: ["requested", "actual"]
          }
        },
        lines: { type: "string", description: "줄마다 '예, 구체적 오류 지적, 오답' 또는 '아니오, 정답' 형식의 텍스트(줄바꿈 또는 ; 로 구분)" }
      }
    }
  },
  { name: "paper_models", description: "논문 표 1·2의 모델 11종(OpenAI 7, Claude 4)의 TP·FN·FP·TN, 정답 수, 균형정확도(계산 불가면 null).", inputSchema: { type: "object", properties: {} } }
];

const PROMPTS = [
  {
    name: "verify-completion",
    description: "AI가 끝냈다고 한 작업을 원문 대조와 논문 방식 재검토로 점검한다",
    arguments: [{ name: "requirement", description: "요구사항 원문", required: true }, { name: "result", description: "AI의 결과와 완료 보고", required: true }]
  }
];

function checkTool(args) {
  const r = SC.check(args && args.source, args && args.output);
  return { ...r, autoSignal: SC.autoSignal(r) };
}
function verifyTool(args) {
  const requirement = args && args.requirement, result = args && args.result;
  const r = SC.check(requirement, result);
  return { autoCheck: r, autoSignal: SC.autoSignal(r), reviewPrompt: RS.buildPrompt(requirement, result), nextSteps: NEXT_STEPS, limits: LIMITS };
}
function scoreTool(args) {
  let rows = [], problems = [];
  if (args && Array.isArray(args.records)) rows = args.records;
  else if (args && typeof args.lines === "string") { const p = RS.parseLines(args.lines); rows = p.rows; problems = p.problems; }
  const out = RS.toJSON(rows, MODELS);
  out.skippedLines = problems;
  return out;
}
function promptTool(args) {
  return { prompt: RS.buildPrompt(args && args.requirement, args && args.result),
           note: "새 대화에서 이 프롬프트로 재검토만 시키고, 결과를 고치게 하거나 정답을 알려 주지 마세요. 돌려받은 JSON은 parse_review_json 또는 화면에 붙여 넣습니다." };
}
function parseTool(args) {
  const p = RS.parseAiJson(args && args.text, args && args.reviewer);
  return { records: p.rows, problems: p.problems, note: "records 의 actual(실제 결과)은 비어 있습니다. 원문과 직접 대조해 correct 또는 wrong 으로 채운 뒤 score_review_signal 에 넣으세요." };
}
function modelsTool() {
  return MODELS.map((m) => ({ name: m.name, provider: m.provider, correct: m.correct, n: m.n, tp: m.tp, fn: m.fn, fp: m.fp, tn: m.tn, balancedAccuracy: RS.balancedOf(m), brier: m.brier }));
}
const RUN = { verify_completion: verifyTool, check_against_source: checkTool, build_review_prompt: promptTool, parse_review_json: parseTool, score_review_signal: scoreTool, paper_models: modelsTool };

function handle(msg) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return ok({ protocolVersion: (params && params.protocolVersion) || "2024-11-05", capabilities: { tools: {}, prompts: {} }, serverInfo: { name: "review-signal", version: "2.0.0" } });
  }
  // 2026-07-28 이후 프로토콜은 initialize 대신 server/discover 를 쓴다(out/llm_integration_facts.md 의 자료 기준). 이 응답 모양은 실제 클라이언트로 시험하지 못했다.
  if (method === "server/discover") {
    return ok({ supportedVersions: ["2026-07-28", "2025-11-25", "2024-11-05"], protocolVersion: "2026-07-28", capabilities: { tools: {}, prompts: {} }, serverInfo: { name: "review-signal", version: "2.0.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "prompts/list") return ok({ prompts: PROMPTS });
  if (method === "prompts/get") {
    if (!params || params.name !== "verify-completion") return err(-32602, "알 수 없는 프롬프트: " + (params && params.name));
    const a = params.arguments || {};
    const v = verifyTool({ requirement: a.requirement, result: a.result });
    const text = "아래 점검을 순서대로 진행하세요.\n\n[자동 원문 대조 결과]\n" + JSON.stringify(v.autoCheck.findings, null, 2) +
      "\n\n[재검토 프롬프트: 결과를 만든 대화와 분리된 새 컨텍스트에서 실행하세요]\n" + v.reviewPrompt + "\n\n[다음 단계]\n" + NEXT_STEPS.join("\n") + "\n\n[한계]\n" + LIMITS;
    return ok({ description: "AI 완료 보고 점검", messages: [{ role: "user", content: { type: "text", text } }] });
  }
  if (method === "tools/call") {
    const name = params && params.name;
    if (!Object.prototype.hasOwnProperty.call(RUN, name)) return err(-32602, "알 수 없는 도구: " + name);
    try {
      const out = RUN[name]((params && params.arguments) || {});
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { models: out } : out, isError: false });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "입력을 처리하지 못했습니다: " + (e && e.message) }], isError: true });
    }
  }
  if (id === undefined || id === null) return null; // 알림(notifications/*)에는 응답하지 않는다
  return err(-32601, "지원하지 않는 메서드: " + method);
}

/* ---------- 로컬 HTTP API ---------- */
const ROUTES = { "/api/verify": verifyTool, "/api/check": checkTool, "/api/prompt": promptTool, "/api/parse": parseTool, "/api/score": scoreTool };
function startHttp(port) {
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { const body = JSON.stringify(obj); res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(body); };
    const url = (req.url || "").split("?")[0];
    if (req.method === "GET" && url === "/health") return send(200, { ok: true, name: "review-signal", endpoints: Object.keys(ROUTES).concat("/api/models") });
    if (req.method === "GET" && url === "/api/models") return send(200, { models: modelsTool() });
    const fn = ROUTES[url];
    if (!fn) return send(404, { error: "없는 경로입니다. GET /health 로 목록을 보세요." });
    if (req.method !== "POST") return send(405, { error: "POST 로 JSON 을 보내세요." });
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 1_000_000) { send(413, { error: "본문이 1MB를 넘습니다." }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (res.writableEnded) return;
      let args = {};
      try { args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch { return send(400, { error: "JSON 해석 실패" }); }
      try { send(200, fn(args && typeof args === "object" ? args : {})); } catch (e) { send(500, { error: String(e && e.message) }); }
    });
  });
  server.listen(port, "127.0.0.1", () => { console.error("review-signal API: http://127.0.0.1:" + server.address().port + " (이 컴퓨터에서만 열림)"); });
  return server;
}

function main() {
  const i = process.argv.indexOf("--http");
  if (i >= 0) { startHttp(Number(process.argv[i + 1]) || 8787); return; }
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 해석 실패" } }) + "\n"); return; }
    const res = handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { handle, verifyTool, checkTool, scoreTool, modelsTool, startHttp };
