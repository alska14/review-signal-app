// 실행: node --test tests/logic.test.js   (Node 18 이상, 외부 라이브러리 없음)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RS = require("../logic.js");

function loadGlobal(file, name) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const window = {};
  new Function("window", src)(window);
  return window[name];
}
const MODELS = loadGlobal("data_models.js", "PAPER_MODELS");
const CASES = loadGlobal("data_cases.js", "PAPER_CASES");
const R = (requested, actual, extra) => Object.assign({ requested, reason: requested === "yes" ? "specific" : "none", actual }, extra || {});

test("균형정확도: 오답 4건 중 3건 검토, 정답 6건 중 1건 검토", () => {
  const rows = [R("yes", "wrong"), R("yes", "wrong"), R("yes", "wrong"), R("no", "wrong"), R("yes", "correct")];
  for (let i = 0; i < 5; i++) rows.push(R("no", "correct"));
  const s = RS.summarize(rows);
  assert.deepEqual([s.tp, s.fn, s.fp, s.tn], [3, 1, 1, 5]);
  assert.equal(s.errReview, 0.75);
  assert.ok(Math.abs(s.balanced - (0.75 + 1 - 1 / 6) / 2) < 1e-12);
});

test("정답 또는 오답이 없으면 계산 불가(null)이고 0%가 아니다", () => {
  const onlyRight = RS.summarize([R("no", "correct"), R("yes", "correct")]);
  assert.equal(onlyRight.balanced, null);
  assert.equal(onlyRight.errReview, null);
  assert.equal(RS.pct(onlyRight.errReview), "계산 불가");
  assert.equal(RS.summarize([R("yes", "wrong")]).balanced, null);
});

test("빈 입력·이상한 입력에도 예외 없이 동작", () => {
  for (const bad of [undefined, null, [], [null], [undefined, 1, "x"], [{}], [{ requested: "maybe", actual: "wrong" }], "문자열", 42]) {
    const s = RS.summarize(bad);
    assert.equal(s.balanced, null);
    assert.ok(Array.isArray(RS.interpret(s)));
    assert.ok(RS.toJSON(bad, MODELS));
  }
  const s = RS.summarize([{ requested: "yes", actual: "" }, { requested: "", actual: "wrong" }]);
  assert.equal(s.used, 0);
  assert.equal(s.skipped, 2);
});

test("Brier: 확신도 있는 줄만 논문 정의대로 계산", () => {
  const s = RS.summarize([R("no", "correct", { confidence: 90 }), R("yes", "wrong", { confidence: 30 }), R("yes", "correct", { confidence: null })]);
  assert.equal(s.brierN, 2);
  assert.ok(Math.abs(s.brier - ((0.1 ** 2) + (0.3 ** 2)) / 2) < 1e-12);
  assert.equal(RS.summarize([R("no", "correct")]).brier, null);
  const bad = RS.summarize([R("no", "correct", { confidence: 150 }), R("no", "correct", { confidence: "x" })]);
  assert.equal(bad.brierN, 0);
});

test("정답인데 확신도 20 이하로 검토 요청한 경우를 센다", () => {
  const s = RS.summarize([R("yes", "correct", { confidence: 5 }), R("yes", "correct", { confidence: 60 }), R("yes", "wrong", { confidence: 5 }), R("no", "correct", { confidence: 5 })]);
  assert.equal(s.lowConfDenials, 1);
});

test("줄 붙여넣기: 올바른 줄은 받고 틀린 줄은 이유와 함께 건너뜀(; 구분 포함)", () => {
  const text = ["예, 구체적 오류 지적, 오답", "아니오, 정답", "", "# 주석", "모름, 정답", "예, 검산 부족, 맞을지도", "예, 이상한 근거, 오답", "한 칸만"].join("\n");
  const p = RS.parseLines(text);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].reason, "specific");
  assert.equal(p.rows[1].requested, "no");
  assert.deepEqual(p.problems.map(x => x.line), [5, 6, 7, 8]);
  assert.equal(RS.parseLines("예, 검산 부족, 오답;아니오, 정답").rows.length, 2);
  assert.equal(RS.parseLines(null).rows.length, 0);
});

test("파서가 constructor·__proto__ 같은 줄을 성공으로 세지 않고, o/x 는 모호해서 받지 않는다", () => {
  const p = RS.parseLines("constructor, 정답\n__proto__, 오답\n예, toString, 오답\no, 정답\nx, 오답");
  assert.equal(p.rows.length, 0);
  assert.equal(p.problems.length, 5);
});

test("검토를 요청하지 않은 줄의 근거는 무시된다", () => {
  assert.equal(RS.parseLines("아니오, 구체적 오류 지적, 오답").rows[0].reason, "none");
});

test("AI 재검토 JSON: 객체·배열·글 속 여러 객체를 읽고, 잘못된 값은 이유를 알려 준다", () => {
  const one = RS.parseAiJson('{"confidence": 40, "needs_review": true, "reason_type": "shortage", "brief_reason": "소수 자릿수를 대조하지 못함"}', "same");
  assert.equal(one.rows.length, 1);
  assert.deepEqual([one.rows[0].requested, one.rows[0].reason, one.rows[0].confidence, one.rows[0].actual], ["yes", "shortage", 40, ""]);
  const arr = RS.parseAiJson('[{"confidence":90,"needs_review":false,"reason_type":"none","brief_reason":"ok"},{"confidence":"15","needs_review":"true","reason_type":"specific","brief_reason":"x"}]', "other");
  assert.equal(arr.rows.length, 2);
  assert.equal(arr.rows[1].confidence, 15);
  assert.equal(arr.rows[1].reviewer, "other");
  const mixed = RS.parseAiJson('결과입니다 {"confidence": 70, "needs_review": false, "brief_reason": "{중괄호} 포함"} 그리고 {"needs_review": true}', "human");
  assert.equal(mixed.rows.length, 2);
  assert.equal(mixed.rows[0].reviewer, "human");
  const bad = RS.parseAiJson('{"confidence": 500, "needs_review": "maybe"}', "same");
  assert.equal(bad.rows.length, 0);
  assert.ok(bad.problems.length >= 1);
  const noJson = RS.parseAiJson("그냥 말만 있음", "same");
  assert.equal(noJson.rows.length, 0);
  assert.equal(noJson.problems.length, 1);
  assert.equal(RS.parseAiJson(undefined, "same").rows.length, 0);
  const outOfRange = RS.parseAiJson('{"confidence": 500, "needs_review": true, "reason_type": "specific"}', "same");
  assert.equal(outOfRange.rows[0].confidence, null);
});

test("프롬프트: 논문 B1의 핵심 지시(수정 금지, 정답 미제공, JSON만)와 사용자 입력이 들어간다", () => {
  const p = RS.buildPrompt("원문 A", "결과 B");
  for (const must of ["결과는 수정하지 마라", "정답이나 채점 피드백은 제공되지 않았다", "confidence", "needs_review", "원문 A", "결과 B", "reason_type"]) assert.ok(p.includes(must), must);
  assert.ok(RS.buildPrompt("", "").includes("여기에 요구사항 원문을 붙여 넣으세요"));
});

test("논문 표의 균형정확도·정답 수와 data_models.js 가 일치", () => {
  assert.equal(MODELS.length, 11);
  const by = Object.fromEntries(MODELS.map(m => [m.name, m]));
  const expect = { "gpt-6-sol": [10, 0.85], "gpt-5.6-sol": [8, 0.75], "gpt-5.6-terra": [7, 0.857], "gpt-5.6-luna": [6, 0.917],
    "Sonnet 5.5": [11, 0.909], "Opus 5.5": [11, 1.0], "Haiku 5.5": [11, 1.0], "Opus 5": [11, 0.955] };
  for (const [name, [correct, bal]] of Object.entries(expect)) {
    assert.equal(by[name].correct, correct, name);
    assert.ok(Math.abs(RS.balancedOf(by[name]) - bal) < 0.0006, name);
  }
  for (const name of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]) assert.equal(RS.balancedOf(by[name]), null, name);
  for (const m of MODELS) assert.equal(m.tp + m.fn + m.fp + m.tn, 12, m.name);
});

test("논문 비교는 '같은 AI' 기록만 쓴다", () => {
  const rows = [R("yes", "wrong", { reviewer: "other" }), R("no", "correct", { reviewer: "other" }), R("yes", "wrong"), R("no", "correct")];
  const g = RS.byReviewer(rows);
  assert.equal(g.same.used, 2);
  assert.equal(g.other.used, 2);
  assert.equal(g.human.used, 0);
  const j = RS.toJSON(rows, MODELS);
  assert.equal(j.byReviewer.same.used, 2);
  assert.match(j.comparisonWithPaper.basis, /같은 AI/);
  assert.equal(RS.compare(0.9, MODELS).usableCount, 8);
});

test("연습 사례 6개: 처음 답 3, 수정안 2, 둘 다 틀림 1", () => {
  assert.equal(CASES.length, 6);
  assert.deepEqual(CASES.map(c => c.right).sort(), ["both", "change", "change", "keep", "keep", "keep"]);
  for (const c of CASES) assert.ok(c.first && c.review && c.why && ["keep", "change", "both"].includes(c.right));
});

test("해석 문구: 오답이 적으면 일반화 경고, 점수 구간은 앱 기준이라고 밝힘", () => {
  const few = RS.summarize([R("yes", "wrong"), R("no", "correct"), R("no", "correct")]);
  assert.match(RS.interpret(few).map(m => m.text).join("\n"), /오답이 1건뿐/);
  const many = [];
  for (let i = 0; i < 6; i++) many.push(R("yes", "wrong"));
  for (let i = 0; i < 6; i++) many.push(R("no", "correct"));
  const text = RS.interpret(RS.summarize(many)).map(m => m.text).join("\n");
  assert.match(text, /논문의 기준이 아닙니다/);
  assert.doesNotMatch(text, /헛 경보/);
});

test("대표 점수에는 자동 대조(앱) 기록이 들어가지 않는다", () => {
  const rows = [R("yes", "wrong"), R("no", "correct"), R("yes", "correct", { reviewer: "auto" }), R("no", "wrong", { reviewer: "auto" })];
  assert.equal(RS.headline(rows).length, 2);
  const j = RS.toJSON(rows, MODELS);
  assert.equal(j.used, 2);
  assert.equal(j.byReviewer.auto.used, 2);
  assert.equal(j.balancedAccuracy, 1);
});
