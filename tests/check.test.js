// 자동 원문 대조 시험: 임시 테스트용 가상 데이터(fixtures.json)로 검출률과 오탐을 센다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SC = require("../check.js");
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));

function types(r) { return r.findings.map(f => f.type); }

test("심어 둔 오류는 모두 찾는다", () => {
  let planted = 0, found = 0;
  for (const c of FIX.filter(x => x.planted.length)) {
    const t = types(SC.check(c.source, c.output));
    for (const p of c.planted) { planted++; if (t.includes(p)) found++; else assert.fail(c.name + ": 못 찾음 " + p + " / 나온 것: " + t.join(", ")); }
  }
  assert.equal(found, planted);
  assert.ok(planted >= 8);
});

test("정상 사례에는 심각한 지적(high)이 없다", () => {
  for (const c of FIX.filter(x => !x.planted.length && !x.knownMiss)) {
    const r = SC.check(c.source, c.output);
    const high = r.findings.filter(f => f.severity === "high");
    assert.equal(high.length, 0, c.name + ": " + JSON.stringify(high.map(h => h.type)));
  }
});

test("한계: 의미를 바꾼 오류(같은 숫자를 다른 항목에 붙임)는 못 잡는다 — 못 잡는다고 밝힌 상태를 유지", () => {
  const c = FIX.find(x => x.knownMiss);
  const r = SC.check(c.source, c.output);
  assert.equal(r.findings.length, 0);
  assert.match(r.limits, /의미/);
});

test("입력이 비면 멈추지 않고 안내", () => {
  for (const [a, b] of [["", ""], [null, "x"], ["x", undefined], ["   ", "  "]]) {
    const r = SC.check(a, b);
    assert.equal(r.ok, false);
    assert.ok(r.error);
    assert.ok(SC.autoSignal(r));
  }
});

test("아주 긴 입력과 특수문자에도 빠르게 끝난다", () => {
  const big = "항목 12.345 ID-77 ".repeat(20000);
  const t0 = Date.now();
  const r = SC.check(big, big);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(r.findings.filter(f => f.severity === "high").length, 0);
  const weird = SC.check("<script>alert(1)</script> 3.14 ±", "<script>alert(1)</script> 3.14 ±");
  assert.equal(weird.findings.length, 0);
});

test("자동 신호: 심각한 지적이 있으면 검토 필요, 없으면 불필요(최종 확인은 사람이)", () => {
  const bad = FIX.find(x => x.name.startsWith("소수"));
  const s1 = SC.autoSignal(SC.check(bad.source, bad.output));
  assert.equal(s1.needs_review, true);
  assert.equal(s1.reason_type, "specific");
  const ok = FIX.find(x => x.name === "정상: 원문 그대로 옮김");
  const s2 = SC.autoSignal(SC.check(ok.source, ok.output));
  assert.equal(s2.needs_review, false);
  assert.equal(s2.reason_type, "none");
});

test("검출률 요약(보고용): 심은 오류 건수와 정상 사례 오탐 건수", () => {
  let planted = 0, found = 0, cleanCases = 0, falseHigh = 0;
  for (const c of FIX) {
    if (c.knownMiss) continue;
    const r = SC.check(c.source, c.output);
    if (c.planted.length) { planted += c.planted.length; found += c.planted.filter(p => types(r).includes(p)).length; }
    else { cleanCases++; if (r.findings.some(f => f.severity === "high")) falseHigh++; }
  }
  console.log("검출 " + found + "/" + planted + ", 정상 " + cleanCases + "건 중 오탐 " + falseHigh + "건");
  assert.equal(found, planted);
  assert.equal(falseHigh, 0);
});
