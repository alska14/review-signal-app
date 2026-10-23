/* AI 완료 보고 점검기: 계산 규칙 (논문 3.3·3.4절)
 * 논문 방식: 최초 답은 고치지 않고, 같은 자료에 대해 확신도(confidence 0~100)와 추가 검토 요청(needs_review)만 다시 받는다.
 * 균형정확도 = (오답 검토율 + 1 - 정답 검토율) / 2
 *   오답 검토율 = 실제 오답 중 '검토 필요'를 표시한 비율 (TP / (TP+FN))
 *   정답 검토율 = 실제 정답 중 같은 표시를 한 비율        (FP / (FP+TN))
 * Brier = confidence/100 과 실제 정답 여부(정답 1, 오답 0)의 제곱 차이 평균. 낮을수록 좋지만 정답률의 영향도 받는다.
 * 정답 또는 오답이 하나도 없으면 균형정확도를 계산하지 않는다(0/0 은 0% 가 아니라 '계산 불가').
 * 브라우저와 Node 양쪽에서 쓰도록 UMD 로 작성했다. 외부 라이브러리 없음. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReviewSignal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var REASON = { shortage: "검산 부족", specific: "구체적 오류 지적", none: "근거 없음" };
  var REVIEWER = { same: "같은 AI", other: "다른 AI", human: "사람", auto: "자동 대조(앱)" };
  var own = Object.prototype.hasOwnProperty;
  function pick(map, key) { return own.call(map, key) ? map[key] : undefined; }

  var REQUEST_WORDS = { "예": "yes", "네": "yes", "y": "yes", "yes": "yes", "true": "yes",
                        "아니오": "no", "아니요": "no", "n": "no", "no": "no", "false": "no" };
  var ACTUAL_WORDS = { "정답": "correct", "맞음": "correct", "맞다": "correct", "correct": "correct", "right": "correct",
                       "오답": "wrong", "틀림": "wrong", "틀렸다": "wrong", "wrong": "wrong" };
  var REASON_WORDS = { "검산 부족": "shortage", "검산부족": "shortage", "shortage": "shortage",
                       "구체적 오류 지적": "specific", "구체적 오류": "specific", "구체적": "specific", "specific": "specific",
                       "근거 없음": "none", "없음": "none", "-": "none", "": "none", "none": "none" };

  function isComplete(row) {
    if (!row || typeof row !== "object") return false;
    if (row.requested !== "yes" && row.requested !== "no") return false;
    if (row.actual !== "correct" && row.actual !== "wrong") return false;
    return true;
  }

  /* ---- 입력 1: 줄 단위 텍스트 "예, 검산 부족, 오답" (줄바꿈 또는 ; 로 구분) ---- */
  function parseLines(text) {
    var rows = [], problems = [];
    var lines = String(text == null ? "" : text).split(/\r?\n|;/);
    if (lines.length > 5000) { problems.push({ line: 5001, text: "", why: "5,000줄까지만 읽습니다. 나머지 " + (lines.length - 5000) + "줄은 건너뜁니다." }); lines.length = 5000; }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      if (/^(#|\/\/)/.test(raw)) continue;
      var parts = raw.split(/[,\t]/).map(function (s) { return s.trim().toLowerCase(); });
      var req, rea, act;
      if (parts.length === 3) { req = parts[0]; rea = parts[1]; act = parts[2]; }
      else if (parts.length === 2) { req = parts[0]; rea = ""; act = parts[1]; }
      else { problems.push({ line: i + 1, text: raw, why: "쉼표로 나눈 칸이 2개 또는 3개여야 합니다(요청, [근거], 실제 결과)." }); continue; }
      var r = pick(REQUEST_WORDS, req), a = pick(ACTUAL_WORDS, act), q = pick(REASON_WORDS, rea);
      if (!r) { problems.push({ line: i + 1, text: raw, why: "첫 칸은 '예' 또는 '아니오'여야 합니다." }); continue; }
      if (!a) { problems.push({ line: i + 1, text: raw, why: "마지막 칸은 '정답' 또는 '오답'이어야 합니다." }); continue; }
      if (q === undefined) { problems.push({ line: i + 1, text: raw, why: "근거는 '검산 부족', '구체적 오류 지적', '근거 없음' 중 하나여야 합니다." }); continue; }
      rows.push({ memo: "", requested: r, reason: r === "yes" ? q : "none", actual: a, confidence: null, reviewer: "same" });
    }
    return { rows: rows, problems: problems };
  }

  /* ---- 입력 2: AI가 돌려준 재검토 JSON (객체 하나, 배열, 또는 여러 객체가 섞인 글) ---- */
  function extractJsonObjects(text) {
    var out = [], s = String(text == null ? "" : text);
    var whole = null;
    try { whole = JSON.parse(s); } catch (e) { whole = null; }
    if (whole !== null) return Array.isArray(whole) ? whole : [whole];
    var depth = 0, start = -1, inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") { if (depth === 0) start = i; depth++; }
      else if (c === "}" && depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) { try { out.push(JSON.parse(s.slice(start, i + 1))); } catch (e2) { out.push(null); } start = -1; }
      }
    }
    return out;
  }

  function parseAiJson(text, reviewer) {
    var rows = [], problems = [];
    var objs = extractJsonObjects(text);
    if (!objs.length) problems.push({ line: 0, why: "JSON을 찾지 못했습니다. AI가 돌려준 {...} 부분을 그대로 붙여 넣으세요." });
    objs.forEach(function (o, idx) {
      var n = idx + 1;
      if (!o || typeof o !== "object" || Array.isArray(o)) { problems.push({ line: n, why: n + "번째 항목을 JSON 객체로 읽지 못했습니다." }); return; }
      var nr = o.needs_review;
      if (typeof nr === "string") nr = nr.trim().toLowerCase() === "true" ? true : (nr.trim().toLowerCase() === "false" ? false : undefined);
      if (typeof nr !== "boolean") { problems.push({ line: n, why: n + "번째 항목: needs_review 가 true 또는 false 가 아닙니다." }); return; }
      var conf = o.confidence;
      if (typeof conf === "string" && conf.trim() !== "" && !isNaN(Number(conf))) conf = Number(conf);
      var confOk = typeof conf === "number" && isFinite(conf) && conf >= 0 && conf <= 100;
      if (conf !== undefined && conf !== null && !confOk) problems.push({ line: n, why: n + "번째 항목: confidence 는 0~100 숫자여야 해서 확신도 없이 넣었습니다." });
      var rt = typeof o.reason_type === "string" ? pick(REASON_WORDS, o.reason_type.trim().toLowerCase()) : undefined;
      var reason = nr ? (rt || "none") : "none";
      if (nr && !rt) problems.push({ line: n, why: n + "번째 항목: reason_type 이 없어 '근거 없음'으로 넣었습니다. 표에서 고칠 수 있습니다." });
      var memo = typeof o.brief_reason === "string" ? o.brief_reason.trim().replace(/\s+/g, " ").slice(0, 60) : "";
      rows.push({ memo: memo, requested: nr ? "yes" : "no", reason: reason, actual: "", confidence: confOk ? Math.round(conf) : null, reviewer: pick(REVIEWER, reviewer) ? reviewer : "same" });
    });
    return { rows: rows, problems: problems };
  }

  /* ---- 논문 B1 자기 평가 프롬프트를 업무용으로 옮긴 문장 ---- */
  function buildPrompt(requirement, result) {
    var req = String(requirement == null ? "" : requirement).trim() || "(여기에 요구사항 원문을 붙여 넣으세요)";
    var res = String(result == null ? "" : result).trim() || "(여기에 AI의 결과와 '완료했다'는 보고를 붙여 넣으세요)";
    return [
      "요청한 JSON 외의 설명은 출력하지 마라.",
      "다음은 AI가 앞서 작성한 결과와 '완료했다'는 보고다. 아래 요구사항 원문을 기준으로, 이 결과 전체가 요구사항을 빠짐없이 올바르게 충족했을 확신도를 0~100 정수 confidence로 평가하라.",
      "실질적인 오류·누락 때문에 추가 검토가 필요하다고 판단하면 needs_review=true, 그렇지 않으면 false로 하라.",
      "needs_review=true이면 reason_type을 구체적인 오류·누락을 짚을 수 있을 때 'specific', 검산이 부족해 확인이 필요할 때 'shortage'로 하고, false이면 'none'으로 하라.",
      "짧은 근거 brief_reason도 반환하라. 결과는 수정하지 마라. 정답이나 채점 피드백은 제공되지 않았다.",
      '출력 형식: {"confidence": 0~100 정수, "needs_review": true 또는 false, "reason_type": "specific" 또는 "shortage" 또는 "none", "brief_reason": "한 줄 근거"}',
      "",
      "요구사항 원문:",
      "<<<",
      req,
      ">>>",
      "",
      "AI의 결과와 완료 보고:",
      "<<<",
      res,
      ">>>"
    ].join("\n");
  }

  function rate(num, den) { return den > 0 ? num / den : null; }

  /* 비율의 95% 윌슨 구간(참고용, 논문에 없음). */
  function wilson(k, n) {
    if (!(n > 0)) return null;
    var z = 1.96, p = k / n, z2 = z * z;
    var denom = 1 + z2 / n;
    var center = (p + z2 / (2 * n)) / denom;
    var half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
    return [Math.max(0, center - half), Math.min(1, center + half)];
  }

  function emptySummary() {
    return { total: 0, used: 0, skipped: 0, tp: 0, fn: 0, fp: 0, tn: 0,
             wrongN: 0, rightN: 0, errReview: null, rightReview: null, balanced: null,
             errCI: null, rightCI: null, balancedCI: null,
             reviewRate: null, brier: null, brierN: 0, lowConfDenials: 0,
             reasons: { shortage: { n: 0, wrong: 0 }, specific: { n: 0, wrong: 0 }, none: { n: 0, wrong: 0 } } };
  }

  /* 정답인데 검토를 요청하면서 확신도가 20 이하인 경우. 논문 4.2절에서 올바른 답을 낮은 확신도로 부정한 사례(확신도 1, 5)를 따라 이 앱이 세는 표시다. */
  var LOW_CONF = 20;

  function summarize(rows) {
    var s = emptySummary();
    var list = Array.isArray(rows) ? rows : [];
    s.total = list.length;
    var sq = 0;
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
      var c = row.confidence;
      if (typeof c === "number" && isFinite(c) && c >= 0 && c <= 100) {
        var d = c / 100 - (wrong ? 0 : 1);
        sq += d * d; s.brierN++;
        if (!wrong && req && c <= LOW_CONF) s.lowConfDenials++;
      }
    });
    s.wrongN = s.tp + s.fn;
    s.rightN = s.fp + s.tn;
    s.errReview = rate(s.tp, s.wrongN);
    s.rightReview = rate(s.fp, s.rightN);
    s.reviewRate = rate(s.tp + s.fp, s.used);
    s.brier = s.brierN > 0 ? sq / s.brierN : null;
    s.errCI = wilson(s.tp, s.wrongN);
    s.rightCI = wilson(s.fp, s.rightN);
    if (s.errReview !== null && s.rightReview !== null) {
      s.balanced = (s.errReview + 1 - s.rightReview) / 2;
      s.balancedCI = [(s.errCI[0] + 1 - s.rightCI[1]) / 2, (s.errCI[1] + 1 - s.rightCI[0]) / 2];
    }
    return s;
  }

  /* 대표 점수에는 '자동 대조(앱)' 기록을 넣지 않는다. 앱의 규칙 신호는 AI 재검토가 아니라서 따로 본다. */
  function headline(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return !(r && r.reviewer === "auto"); });
  }

  /* 검토자(같은 AI / 다른 AI / 사람)별로 따로 요약. 논문 비교는 '같은 AI' 기록에만 쓴다. */
  function byReviewer(rows) {
    var groups = { same: [], other: [], human: [], auto: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var k = r && pick(REVIEWER, r.reviewer) ? r.reviewer : "same";
      groups[k].push(r);
    });
    var out = {};
    Object.keys(groups).forEach(function (k) { out[k] = summarize(groups[k]); });
    return out;
  }

  function balancedOf(m) {
    var e = rate(m.tp, m.tp + m.fn), r = rate(m.fp, m.fp + m.tn);
    return e !== null && r !== null ? (e + 1 - r) / 2 : null;
  }

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
  function range(ci) { return ci ? pct(ci[0], 0) + "~" + pct(ci[1], 0) : "계산 불가"; }

  /* 결과 해석 문구. 점수 구간(90%·70%)은 이 앱이 정한 참고 기준이며 논문의 기준이 아니다. */
  function interpret(s) {
    var msgs = [];
    if (s.used === 0) {
      msgs.push({ level: "info", text: "아직 계산할 수 있는 기록이 없습니다. 각 줄의 '검토 요청'과 '실제 결과'를 모두 고르세요." });
      return msgs;
    }
    if (s.skipped > 0) msgs.push({ level: "info", text: "빈칸이 있는 " + s.skipped + "줄은 계산에서 뺐습니다. 실제 결과를 확인한 줄만 점수에 들어갑니다." });
    if (s.reviewRate !== null && s.used > 0) msgs.push({ level: "info", text: "'완료했다'고 한 결과 " + s.used + "건 중 재검토가 다시 확인하라고 한 것은 " + (s.tp + s.fp) + "건(" + pct(s.reviewRate, 0) + ")입니다. 이 숫자만으로는 어느 쪽이 맞았는지 알 수 없고, 아래 실제 결과와 맞춰 봐야 합니다." });
    if (s.wrongN === 0) msgs.push({ level: "warn", text: "실제 오답이 0건이라 오답 검토율을 계산할 수 없습니다. 논문에서도 정답률이 높은 모델은 같은 이유로 비교하지 못했습니다(0/0은 0%가 아닙니다)." });
    if (s.rightN === 0) msgs.push({ level: "warn", text: "실제 정답이 0건이라 정답 검토율을 계산할 수 없습니다. 이 경우 '검토 요청이 맞았다'는 결론을 내리지 마세요." });
    if (s.balanced !== null) {
      msgs.push({ level: "info", text: "불확실한 정도: 균형정확도는 약 " + range(s.balancedCI) + " 사이에서 흔들릴 수 있습니다(95% 윌슨 구간을 이어 붙인 대략적 범위이며 논문에 없는 참고 계산입니다)." });
      if (s.wrongN < 5) msgs.push({ level: "warn", text: "오답이 " + s.wrongN + "건뿐입니다. 논문에서도 오답 1건으로 얻은 100%를 '오류 탐지 능력 100%'로 읽지 않았습니다. 기록을 더 쌓은 뒤 판단하세요." });
      else if (s.balanced >= 0.9) msgs.push({ level: "ok", text: "이 기록에서는 재검토 신호가 실제 오답을 잘 가려낸 편입니다. 그래도 정답인데 검토를 요청한 경우가 " + s.fp + "건 있었는지 같이 보세요. (점수 구간은 이 앱의 참고 기준이며 논문의 기준이 아닙니다.)" });
      else if (s.balanced >= 0.7) msgs.push({ level: "mid", text: "재검토 신호가 어느 정도 맞았지만 놓친 오답(" + s.fn + "건)이나 정답인데 검토를 요청한 경우(" + s.fp + "건)가 남아 있습니다. 중요한 결과는 직접 대조하세요. (점수 구간은 이 앱의 참고 기준이며 논문의 기준이 아닙니다.)" });
      else msgs.push({ level: "bad", text: "재검토 신호가 오답과 정답을 잘 구분하지 못했습니다. 이 AI의 '검토 필요' 표시는 참고만 하고 결과를 직접 확인하는 절차를 두세요. (점수 구간은 이 앱의 참고 기준이며 논문의 기준이 아닙니다.)" });
    }
    if (s.fn > 0) msgs.push({ level: "warn", text: "재검토가 '검토 불필요'로 표시했는데 실제로는 틀린 결과가 " + s.fn + "건입니다. 표시만 믿고 넘어갔다면 놓쳤을 오답입니다." });
    if (s.lowConfDenials > 0) msgs.push({ level: "warn", text: "정답인데 확신도 " + LOW_CONF + " 이하로 검토를 요청한 경우가 " + s.lowConfDenials + "건입니다. 논문 4.2절에도 올바른 답을 낮은 확신도로 의심한 사례가 있었습니다(이 표시 기준은 앱이 정한 것). 이런 재검토의 수정안은 그대로 따르지 마세요." });
    if (s.brier !== null) msgs.push({ level: "info", text: "Brier 점수 " + s.brier.toFixed(3) + " (확신도를 적은 " + s.brierN + "건 기준, 낮을수록 좋음). 논문 모델은 0~0.739였고, 정답률의 영향도 받으므로 오류 구별 능력과 같은 뜻으로 읽지 않습니다(논문 3.4절)." });
    var sp = s.reasons.specific, sh = s.reasons.shortage;
    if (sp.n + sh.n > 0) {
      msgs.push({ level: "info", text: "검토 요청 근거별로 보면 '구체적 오류 지적' " + sp.n + "건 중 실제 오답 " + sp.wrong + "건, '검산 부족' " + sh.n + "건 중 실제 오답 " + sh.wrong + "건입니다. 논문은 두 근거를 구분해서 읽었습니다(근거 유형 칸은 앱이 추가한 것)." });
    }
    msgs.push({ level: "info", text: "검토 요청은 '오류를 확정했다'는 뜻이 아닙니다. 정답에 붙은 검토 요청도 업무에서는 신중한 행동일 수 있어 논문은 이를 곧바로 불필요한 행동으로 평가하지 않았습니다. 재검토가 수정안을 내놓아도 원래 결과와 같은 기준으로 다시 확인한 뒤에 바꾸세요." });
    return msgs;
  }

  /* 기계가 읽는 결과(주소 연동·MCP·WebMCP·화면 JSON 블록이 같은 모양을 쓴다). */
  function toJSON(rows, models) {
    var s = summarize(headline(rows));
    var groups = byReviewer(rows);
    var same = groups.same;
    var cmp = compare(same.balanced, models || []);
    return {
      note: "대표 점수에는 '자동 대조(앱)' 기록이 들어가지 않습니다(byReviewer.auto 에서 따로 봄).",
      used: s.used, skipped: s.skipped,
      counts: { tp: s.tp, fn: s.fn, fp: s.fp, tn: s.tn },
      wrongN: s.wrongN, rightN: s.rightN,
      reviewRequestedRate: s.reviewRate,
      errorReviewRate: s.errReview, rightReviewRate: s.rightReview, balancedAccuracy: s.balanced,
      balancedAccuracyRange95: s.balancedCI,
      brier: s.brier, brierCount: s.brierN, lowConfidenceDenials: s.lowConfDenials,
      reasons: s.reasons,
      byReviewer: { same: { used: groups.same.used, balancedAccuracy: groups.same.balanced },
                    other: { used: groups.other.used, balancedAccuracy: groups.other.balanced },
                    human: { used: groups.human.used, balancedAccuracy: groups.human.balanced },
                    auto: { used: groups.auto.used, balancedAccuracy: groups.auto.balanced } },
      comparisonWithPaper: { basis: "같은 AI가 자기 결과를 다시 평가한 기록만", usableModels: cmp.usableCount, belowMine: cmp.below, aboveMine: cmp.above, same: cmp.same },
      notes: interpret(s).map(function (n) { return n.text; }),
      source: "논문 3.3·3.4절 식, 표 1·2 (공통 12문항, 모델당 1회 실행, 탐색 연구). 근거 유형·검토자 구분은 앱이 추가한 칸."
    };
  }

  return { REASON: REASON, REVIEWER: REVIEWER, LOW_CONF: LOW_CONF, isComplete: isComplete,
           parseLines: parseLines, parseAiJson: parseAiJson, headline: headline, buildPrompt: buildPrompt,
           summarize: summarize, byReviewer: byReviewer, balancedOf: balancedOf, compare: compare,
           interpret: interpret, pct: pct, wilson: wilson, range: range, toJSON: toJSON };
});
