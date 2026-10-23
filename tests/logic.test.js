// 실행: node --test app/tests   (Node 18 이상, 외부 라이브러리 없음)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RS = require("../logic.js");

function loadModels() {
  const src = fs.readFileSync(path.join(__dirname, "..", "data_models.js"), "utf8");
  const window = {};
  new Function("window", src)(window);
  return window.PAPER_MODELS;
}
function loadCases() {
  const src = fs.readFileSync(path.join(__dirname, "..", "data_cases.js"), "utf8");
  const window = {};
  new Function("window", src)(window);
  return window.PAPER_CASES;
}

test("균형정확도: 오답 4건 중 3건 검토, 정답 6건 중 1건 검토", () => {
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push({ requested: "yes", reason: "specific", actual: "wrong" });
  rows.push({ requested: "no", reason: "", actual: "wrong" });
  rows.push({ requested: "yes", reason: "shortage", actual: "correct" });
  for (let i = 0; i < 5; i++) rows.push({ requested: "no", reason: "", actual: "correct" });
  const s = RS.summarize(rows);
  assert.deepEqual([s.tp, s.fn, s.fp, s.tn], [3, 1, 1, 5]);
  assert.equal(s.errReview, 0.75);
  assert.ok(Math.abs(s.rightReview - 1 / 6) < 1e-12);
  assert.ok(Math.abs(s.balanced - (0.75 + 1 - 1 / 6) / 2) < 1e-12);
});

test("정답이 없거나 오답이 없으면 계산 불가(null)이고 0%가 아니다", () => {
  const onlyRight = RS.summarize([{ requested: "no", actual: "correct" }, { requested: "yes", reason: "none", actual: "correct" }]);
  assert.equal(onlyRight.balanced, null);
  assert.equal(onlyRight.errReview, null);
  assert.equal(RS.pct(onlyRight.errReview), "계산 불가");
  const onlyWrong = RS.summarize([{ requested: "yes", reason: "specific", actual: "wrong" }]);
  assert.equal(onlyWrong.balanced, null);
  assert.equal(onlyWrong.rightReview, null);
});

test("빈 입력·이상한 입력에도 예외 없이 동작", () => {
  for (const bad of [undefined, null, [], [null], [undefined, 1, "x"], [{}], [{ requested: "maybe", actual: "wrong" }], "문자열", 42]) {
    const s = RS.summarize(bad);
    assert.equal(s.balanced, null);
    assert.ok(Array.isArray(RS.interpret(s)));
  }
  const s = RS.summarize([{ requested: "yes", actual: "" }, { requested: "", actual: "wrong" }]);
  assert.equal(s.used, 0);
  assert.equal(s.skipped, 2);
});

test("줄 붙여넣기: 올바른 줄은 받고 틀린 줄은 이유와 함께 건너뜀", () => {
  const text = ["예, 구체적 오류 지적, 오답", "아니오, 정답", "", "# 주석", "모름, 정답", "예, 검산 부족, 맞을지도", "예, 이상한 근거, 오답", "한 칸만"].join("\n");
  const p = RS.parseLines(text);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].reason, "specific");
  assert.equal(p.rows[1].requested, "no");
  assert.equal(p.problems.length, 4);
  assert.deepEqual(p.problems.map(x => x.line), [5, 6, 7, 8]);
  assert.equal(RS.parseLines(null).rows.length, 0);
  assert.equal(RS.parseLines(undefined).problems.length, 0);
});

test("검토를 요청하지 않은 줄의 근거는 무시된다", () => {
  const p = RS.parseLines("아니오, 구체적 오류 지적, 오답");
  assert.equal(p.rows[0].reason, "none");
});

test("논문 표의 균형정확도·정답 수와 data_models.js 가 일치", () => {
  const models = loadModels();
  assert.equal(models.length, 11);
  const by = Object.fromEntries(models.map(m => [m.name, m]));
  const expect = { // 논문 표 1(표기 보완)·표 2(내용 기준)
    "gpt-6-sol": [10, 0.85], "gpt-5.6-sol": [8, 0.75], "gpt-5.6-terra": [7, 0.857], "gpt-5.6-luna": [6, 0.917],
    "Sonnet 5.5": [11, 0.909], "Opus 5.5": [11, 1.0], "Haiku 5.5": [11, 1.0], "Opus 5": [11, 0.955]
  };
  for (const [name, [correct, bal]] of Object.entries(expect)) {
    assert.equal(by[name].correct, correct, name);
    assert.ok(Math.abs(RS.balancedOf(by[name]) - bal) < 0.0006, name + " " + RS.balancedOf(by[name]));
  }
  for (const name of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]) assert.equal(RS.balancedOf(by[name]), null, name);
  for (const m of models) assert.equal(m.tp + m.fn + m.fp + m.tn, 12, m.name);
});

test("논문 비교: 내 값보다 낮은 모델 수를 센다", () => {
  const models = loadModels();
  const c = RS.compare(0.9, models);
  assert.equal(c.usableCount, 8);
  assert.equal(c.below + c.above + c.same, 8);
  assert.equal(RS.compare(null, models).below, 0);
  assert.equal(RS.compare(0.5, []).usableCount, 0);
});

test("연습 사례: 4개이고 정답 방향은 유지 3, 변경 1", () => {
  const cases = loadCases();
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(c => c.right).sort(), ["change", "keep", "keep", "keep"]);
  for (const c of cases) { assert.ok(c.first && c.review && c.why); }
});

test("해석 문구: 오답이 적으면 일반화 경고가 붙는다", () => {
  const s = RS.summarize([{ requested: "yes", reason: "specific", actual: "wrong" }, { requested: "no", actual: "correct" }, { requested: "no", actual: "correct" }]);
  assert.equal(s.balanced, 1);
  const msgs = RS.interpret(s).map(m => m.text).join("\n");
  assert.match(msgs, /오답이 1건뿐/);
});
