/* 검토 신호 점검기: 계산 규칙 (논문 3.4절)
 * 균형정확도 = (오답 검토율 + 1 - 정답 검토율) / 2
 *   오답 검토율 = 실제 오답 중 AI가 '검토 필요'를 표시한 비율 (TP / (TP+FN))
 *   정답 검토율 = 실제 정답 중 같은 표시를 한 비율          (FP / (FP+TN))
 * 정답 또는 오답이 하나도 없으면 계산하지 않는다(0/0 은 0% 가 아니라 '계산 불가').
 * 브라우저와 Node 양쪽에서 쓰도록 UMD 로 작성했다. 외부 라이브러리 없음. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReviewSignal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var REQ = { yes: "예", no: "아니오" };
  var REASON = { shortage: "검산 부족", specific: "구체적 오류 지적", none: "근거 없음" };
  var ACTUAL = { correct: "정답", wrong: "오답" };

  function isComplete(row) {
    if (!row || typeof row !== "object") return false;
    if (row.requested !== "yes" && row.requested !== "no") return false;
    if (row.actual !== "correct" && row.actual !== "wrong") return false;
    return true;
  }

  /* 줄 단위 텍스트("예,검산 부족,오답")를 행으로 바꾼다. 잘못된 줄은 건너뛰고 이유를 돌려준다. */
  function parseLines(text) {
    var rows = [], problems = [];
    var lines = String(text == null ? "" : text).split(/\r?\n/);
    var requestWords = { "예": "yes", "네": "yes", "y": "yes", "yes": "yes", "true": "yes", "o": "yes",
                         "아니오": "no", "아니요": "no", "n": "no", "no": "no", "false": "no", "x": "no" };
    var actualWords = { "정답": "correct", "맞음": "correct", "맞다": "correct", "correct": "correct", "o": "correct",
                        "오답": "wrong", "틀림": "wrong", "틀렸다": "wrong", "wrong": "wrong", "x": "wrong" };
    var reasonWords = { "검산 부족": "shortage", "검산부족": "shortage", "shortage": "shortage",
                        "구체적 오류 지적": "specific", "구체적 오류": "specific", "구체적": "specific", "specific": "specific",
                        "근거 없음": "none", "없음": "none", "-": "none", "": "none", "none": "none" };
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      if (/^(#|\/\/)/.test(raw)) continue;
      var parts = raw.split(/[,\t]/).map(function (s) { return s.trim().toLowerCase(); });
      var req, rea, act;
      if (parts.length === 3) { req = parts[0]; rea = parts[1]; act = parts[2]; }
      else if (parts.length === 2) { req = parts[0]; rea = ""; act = parts[1]; }
      else { problems.push({ line: i + 1, text: raw, why: "쉼표로 나눈 칸이 2개 또는 3개여야 합니다(요청, [근거], 실제 결과)." }); continue; }
      var r = requestWords[req], a = actualWords[act], q = reasonWords[rea];
      if (!r) { problems.push({ line: i + 1, text: raw, why: "첫 칸은 '예' 또는 '아니오'여야 합니다." }); continue; }
      if (!a) { problems.push({ line: i + 1, text: raw, why: "마지막 칸은 '정답' 또는 '오답'이어야 합니다." }); continue; }
      if (q === undefined) { problems.push({ line: i + 1, text: raw, why: "근거는 '검산 부족', '구체적 오류 지적', '근거 없음' 중 하나여야 합니다." }); continue; }
      rows.push({ memo: "", requested: r, reason: r === "yes" ? q : "none", actual: a });
    }
    return { rows: rows, problems: problems };
  }

  function rate(num, den) { return den > 0 ? num / den : null; }

  function summarize(rows) {
    var s = { total: 0, used: 0, skipped: 0, tp: 0, fn: 0, fp: 0, tn: 0,
              wrongN: 0, rightN: 0, errReview: null, rightReview: null, balanced: null,
              reasons: { shortage: { n: 0, wrong: 0 }, specific: { n: 0, wrong: 0 }, none: { n: 0, wrong: 0 } } };
    var list = Array.isArray(rows) ? rows : [];
    s.total = list.length;
    list.forEach(function (row) {
      if (!isComplete(row)) { s.skipped++; return; }
      s.used++;
      var wrong = row.actual === "wrong";
      var req = row.requested === "yes";
      if (wrong && req) s.tp++;
      else if (wrong && !req) s.fn++;
      else if (!wrong && req) s.fp++;
      else s.tn++;
      if (req) {
        var key = row.reason === "specific" || row.reason === "shortage" ? row.reason : "none";
        s.reasons[key].n++;
        if (wrong) s.reasons[key].wrong++;
      }
    });
    s.wrongN = s.tp + s.fn;
    s.rightN = s.fp + s.tn;
    s.errReview = rate(s.tp, s.wrongN);
    s.rightReview = rate(s.fp, s.rightN);
    if (s.errReview !== null && s.rightReview !== null) s.balanced = (s.errReview + 1 - s.rightReview) / 2;
    return s;
  }

  function balancedOf(m) {
    var e = rate(m.tp, m.tp + m.fn), r = rate(m.fp, m.fp + m.tn);
    return e !== null && r !== null ? (e + 1 - r) / 2 : null;
  }

  /* 논문 11개 모델과 비교: 계산 가능한 모델만 쓰고, 내 값보다 낮은/높은 모델 수를 센다. */
  function compare(balanced, models) {
    var usable = (models || []).map(function (m) { return { name: m.name, provider: m.provider, value: balancedOf(m), wrongN: m.tp + m.fn }; })
      .filter(function (m) { return m.value !== null; });
    var out = { usableCount: usable.length, below: 0, above: 0, same: 0, min: null, max: null };
    if (!usable.length) return out;
    out.min = Math.min.apply(null, usable.map(function (m) { return m.value; }));
    out.max = Math.max.apply(null, usable.map(function (m) { return m.value; }));
    if (balanced === null || balanced === undefined) return out;
    usable.forEach(function (m) {
      if (Math.abs(m.value - balanced) < 1e-9) out.same++;
      else if (m.value < balanced) out.below++; else out.above++;
    });
    return out;
  }

  function pct(x, digits) {
    if (x === null || x === undefined || isNaN(x)) return "계산 불가";
    return (x * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  }

  /* 결과 해석 문장. 논문의 주의(표본이 작으면 일반화하지 않는다, 검토 요청은 오류 확정이 아니다)를 그대로 붙인다. */
  function interpret(s) {
    var msgs = [];
    if (s.used === 0) {
      msgs.push({ level: "info", text: "아직 계산할 수 있는 기록이 없습니다. 각 줄의 '검토 요청'과 '실제 결과'를 모두 고르세요." });
      return msgs;
    }
    if (s.skipped > 0) msgs.push({ level: "info", text: "빈칸이 있는 " + s.skipped + "줄은 계산에서 뺐습니다." });
    if (s.wrongN === 0) msgs.push({ level: "warn", text: "실제 오답이 0건이라 오답 검토율을 계산할 수 없습니다. 논문에서도 정답률이 높은 모델은 같은 이유로 비교하지 못했습니다(0/0은 0%가 아닙니다)." });
    if (s.rightN === 0) msgs.push({ level: "warn", text: "실제 정답이 0건이라 정답 검토율을 계산할 수 없습니다. 이 경우 '검토 요청이 맞았다'는 결론을 내리지 마세요." });
    if (s.balanced !== null) {
      if (s.wrongN < 5) msgs.push({ level: "warn", text: "오답이 " + s.wrongN + "건뿐입니다. 논문에서도 오답 1건으로 얻은 100%를 '오류 탐지 능력 100%'로 읽지 않았습니다. 기록을 더 쌓은 뒤 판단하세요." });
      if (s.balanced >= 0.9) msgs.push({ level: "ok", text: "이 기록에서는 AI의 검토 신호가 실제 오답을 꽤 잘 가려냈습니다. 그래도 정답에 붙은 검토 요청이 " + s.fp + "건 있었는지 같이 보세요." });
      else if (s.balanced >= 0.7) msgs.push({ level: "mid", text: "검토 신호가 어느 정도 맞았지만 놓친 오답(" + s.fn + "건)이나 헛 경보(" + s.fp + "건)가 남아 있습니다. 신호만 믿지 말고 중요한 결과는 직접 대조하세요." });
      else msgs.push({ level: "bad", text: "검토 신호가 오답과 정답을 잘 구분하지 못했습니다. 이 AI의 '검토 필요' 표시는 참고만 하고, 결과를 직접 확인하는 절차를 두세요." });
    }
    if (s.fn > 0) msgs.push({ level: "warn", text: "AI가 '검토 불필요'로 표시했는데 실제로는 틀린 답이 " + s.fn + "건입니다. 이것이 가장 위험한 경우입니다." });
    var sp = s.reasons.specific, sh = s.reasons.shortage;
    if (sp.n + sh.n > 0) {
      msgs.push({ level: "info", text: "검토 요청 근거별로 보면 '구체적 오류 지적' " + sp.n + "건 중 실제 오답 " + sp.wrong + "건, '검산 부족' " + sh.n + "건 중 실제 오답 " + sh.wrong + "건입니다. 논문은 두 근거를 구분해서 읽었습니다." });
    }
    msgs.push({ level: "info", text: "검토 요청은 '오류를 확정했다'는 뜻이 아닙니다. 수정안이 붙어 있어도 원래 답과 같은 기준으로 다시 확인한 뒤에 바꾸세요." });
    return msgs;
  }

  return { REQ: REQ, REASON: REASON, ACTUAL: ACTUAL, isComplete: isComplete, parseLines: parseLines,
           summarize: summarize, balancedOf: balancedOf, compare: compare, interpret: interpret, pct: pct };
});
