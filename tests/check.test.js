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
  assert.ok(planted >= 8, "심어 둔 오류는 같은 작성자가 규칙에 맞춰 만든 것이라 검증이 아니라 회귀 시험이다");
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

test("자동 신호: 심각한 지적이 있으면 검토 필요, 없으면 불필요, 확신도는 지어내지 않는다", () => {
  const s1 = SC.autoSignal(SC.check("허용 오차 ±0.5 mm", "허용 오차 0.5 mm"));
  assert.equal(s1.needs_review, true);
  assert.equal(s1.reason_type, "specific");
  assert.equal(s1.confidence, null);
  const fmt = SC.check("평점 4.50", "평점 4.5");
  assert.equal(fmt.findings[0].severity, "low", "값이 같은 표기 변환은 low");
  assert.equal(SC.autoSignal(fmt).needs_review, false);
  const real = SC.check("값 0.96852454", "값 0.9685");
  assert.equal(real.findings[0].type, "소수 자릿수 손실");
  assert.equal(real.findings[0].severity, "high");
  const ok = FIX.find(x => x.name === "정상: 원문 그대로 옮김");
  const s2 = SC.autoSignal(SC.check(ok.source, ok.output));
  assert.equal(s2.needs_review, false);
  assert.equal(s2.reason_type, "none");
  assert.equal(s2.confidence, null);
});

test("입력 길이 상한과 성능: 숫자·ID가 많은 25만 자도 1초 안에 끝난다", () => {
  const big = "A-1. ".repeat(50000);
  const t0 = Date.now();
  assert.equal(SC.check(big, big).ok, true);
  assert.ok(Date.now() - t0 < 1000, "느림: " + (Date.now() - t0));
  const huge = SC.check("x".repeat(300001), "y");
  assert.equal(huge.ok, false);
  assert.match(huge.error, /너무 깁니다/);
});

test("별도 사례 16개(임시 테스트용 가상 데이터, 현실적 난이도)의 실제 성적을 기록한다: 지금 수치가 바뀌면 보고서도 고쳐야 한다", () => {
  const EXTRA = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures_extra.json"), "utf8"));
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const c of EXTRA) {
    const flag = SC.autoSignal(SC.check(c.source, c.output)).needs_review;
    if (c.truth === "wrong") flag ? tp++ : fn++; else flag ? fp++ : tn++;
  }
  console.log("별도 사례 16개: 오류 10건 중 " + tp + "건 지적, 정상 6건 중 " + fp + "건 오탐");
  assert.deepEqual([tp, fn, fp, tn], [4, 6, 1, 5]);
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

test("숫자가 비슷해 보여도 값이 다르면 보존으로 치지 않는다(합계 100 → 1000)", () => {
  const r = SC.check("합계 100", "합계 1000");
  assert.ok(r.findings.some(f => f.type === "숫자 누락 또는 변경" && f.severity === "high"));
  assert.equal(SC.autoSignal(r).needs_review, true);
  assert.equal(SC.check("연락처 010-0000-0000", "연락처 01000000000").findings.filter(f => f.severity !== "low").length, 0, "하이픈만 빠진 전화번호는 서식 차이");
  assert.equal(SC.check("값 2026-10-23", "값 2026년 10월 23일").findings.length, 0);
});

test("대조할 숫자·ID·기호·항목이 없으면 '검토 불필요'가 아니라 판단 불가", () => {
  const r = SC.check("고객에게 정중하게 사과하는 메일을 쓴다.", "죄송합니다. 확인 후 안내드리겠습니다.");
  const s = SC.autoSignal(r);
  assert.equal(s.inconclusive, true);
  assert.equal(s.needs_review, null);
  assert.equal(r.stats.checkable, 0);
  assert.equal(SC.autoSignal(SC.check("값 3.14", "값 3.14")).inconclusive, undefined);
});
