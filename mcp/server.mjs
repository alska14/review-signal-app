#!/usr/bin/env node
// 검토 신호 점검기 MCP 서버 (표준 입출력, 외부 패키지 없음, Node 18+)
// 어떤 LLM 앱이든 MCP 서버로 등록하면 도구 2개를 부를 수 있다.
//   score_review_signal : AI 답변 기록(요청 여부·근거·실제 결과)을 넣으면 논문 3.4절 방식으로 점수를 계산
//   paper_models        : 논문 표 1·2의 모델 11종 TP·FN·FP·TN과 균형정확도
// 입력은 서버로 보내지 않고 이 프로세스 안에서만 계산한다. 비밀값·네트워크 요청 없음.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RS = require(join(here, "..", "logic.js"));
const win = {};
new Function("window", readFileSync(join(here, "..", "data_models.js"), "utf8"))(win);
const MODELS = win.PAPER_MODELS;

const TOOLS = [
  {
    name: "score_review_signal",
    description: "AI 재검토의 '검토 필요' 표시가 실제 오답을 얼마나 가려냈는지 계산한다(논문 「언어모델의 정답률과 추가 검토 요청의 일치와 불일치」 3.4절: 균형정확도 = (오답 검토율 + 1 − 정답 검토율)/2). 정답 또는 오답이 0건이면 0%가 아니라 계산 불가(null)로 돌려준다. records 또는 lines 중 하나를 넣는다.",
    inputSchema: {
      type: "object",
      properties: {
        records: {
          type: "array", description: "답변 하나가 한 원소",
          items: {
            type: "object",
            properties: {
              requested: { type: "string", enum: ["yes", "no"], description: "재검토가 '검토 필요'라고 했는가" },
              confidence: { type: "number", description: "재검토가 적은 확신도 0~100(선택, Brier 계산용)" },
              reviewer: { type: "string", enum: ["same", "other", "human"], description: "재검토한 쪽(기본 same)" },
              reason: { type: "string", enum: ["shortage", "specific", "none"], description: "검토 요청의 근거: 검산 부족 / 구체적 오류 지적 / 근거 없음" },
              actual: { type: "string", enum: ["correct", "wrong"], description: "내가 확인한 실제 결과" }
            },
            required: ["requested", "actual"]
          }
        },
        lines: { type: "string", description: "줄마다 '예, 구체적 오류 지적, 오답' 또는 '아니오, 정답' 형식의 텍스트" }
      }
    }
  },
  {
    name: "build_review_prompt",
    description: "논문 부록 B1의 자기 평가 프롬프트를 업무용으로 옮긴 문장을 만든다. 요구사항 원문과 AI의 결과·완료 보고를 넣으면, 다른 AI 대화에 붙여 재검토만 시킬 프롬프트를 돌려준다.",
    inputSchema: { type: "object", properties: { requirement: { type: "string" }, result: { type: "string" } } }
  },
  {
    name: "parse_review_json",
    description: "AI가 돌려준 재검토 JSON(confidence, needs_review, reason_type, brief_reason)을 기록 형식으로 바꾼다. 실제 결과(actual)는 사람이 확인해서 채워야 한다.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, reviewer: { type: "string", enum: ["same", "other", "human"] } }, required: ["text"] }
  },
  {
    name: "paper_models",
    description: "논문 표 1·2의 모델 11종(OpenAI 7, Claude 4)의 TP·FN·FP·TN, 정답 수, 균형정확도(계산 불가면 null).",
    inputSchema: { type: "object", properties: {} }
  }
];

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

function handle(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return ok({ protocolVersion: (params && params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "review-signal", version: "1.1.0" } });
  }
  // 2026-07-28 이후 프로토콜은 initialize 대신 server/discover 를 쓴다(자료 확인: out/llm_integration_facts.md). 이 응답 모양은 실제 클라이언트로 시험하지 못했다.
  if (method === "server/discover") {
    return ok({ supportedVersions: ["2026-07-28", "2025-11-25", "2024-11-05"], protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "review-signal", version: "1.1.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const name = params && params.name;
    try {
      let out;
      if (name === "score_review_signal") out = scoreTool(params.arguments || {});
      else if (name === "build_review_prompt") out = promptTool(params.arguments || {});
      else if (name === "parse_review_json") out = parseTool(params.arguments || {});
      else if (name === "paper_models") out = modelsTool();
      else return err(-32602, "알 수 없는 도구: " + name);
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { models: out } : out, isError: false });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "입력을 처리하지 못했습니다: " + (e && e.message) }], isError: true });
    }
  }
  if (id === undefined || id === null) return null; // 알림(notifications/*)에는 응답하지 않는다
  return err(-32601, "지원하지 않는 메서드: " + method);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 해석 실패" } }) + "\n"); return; }
    const res = handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}
export { handle, scoreTool, modelsTool };
