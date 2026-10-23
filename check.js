/* 자동 원문 대조: 원문(요구사항·입력 자료)과 AI 결과를 LLM 없이 기계적으로 맞춰 본다.
 * 논문 서론의 동기 사례(기호 오독, 소수 자릿수 손실, 내용 누락)처럼 '글자·숫자 수준'에서 확인되는 불일치만 찾는다.
 * 의미가 맞는지, 계산이 옳은지, 요구사항을 이해했는지는 판단하지 못한다. 찾지 못했다는 것이 문제없다는 뜻이 아니다.
 * 논문의 결과가 아니라 앱이 추가한 확장이다. 브라우저와 Node 양쪽에서 쓰는 UMD, 외부 라이브러리 없음. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SourceCheck = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NUM_RE = /(?:[-+−]?\d[\d,]*(?:\.\d+)?|[-+−]?\.\d+)%?/g;
  var ID_RE = /\b[A-Za-z]{1,12}[-_#]?\d{1,8}(?:[-_#.]\d{1,8})*\b/g;
  /* 의미가 달라지기 쉬운 기호(부등호, 곱셈, 단위 접두어 등). */
  var SYMBOLS = ["≤", "≥", "≠", "±", "×", "÷", "≈", "→", "←", "°", "µ", "μ", "√", "∑", "∆", "Δ", "<", ">", "=", "%", "‰", "℃", "㎎", "㎍", "㎖", "㎏"];

  function normNum(tok) {
    return tok.replace(/−/g, "-").replace(/,/g, "").replace(/%$/, "");
  }
  function idRanges(text) {
    var out = [], m, s = String(text == null ? "" : text);
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(s)) !== null) out.push([m.index, m.index + m[0].length]);
    return out;
  }
  function numbers(text, skipIds) {
    var out = [], m, s = String(text == null ? "" : text);
    var ranges = skipIds ? idRanges(s) : [];
    var ri = 0;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s)) !== null) {
      var raw = m[0], index = m.index;
      /* 부호처럼 보여도 앞이 글자·숫자·#이면 하이픈(ID, 날짜)이다 */
      if (/^[-+−]/.test(raw) && index > 0 && /[A-Za-z0-9#_가-힣]/.test(s.charAt(index - 1))) { raw = raw.slice(1); index += 1; }
      while (ri < ranges.length && ranges[ri][1] <= index) ri++; /* 번호는 오름차순이라 한 번만 훑는다 */
      if (ri < ranges.length && index >= ranges[ri][0] && index < ranges[ri][1]) continue;
      var norm = normNum(raw);
      if (!/\d/.test(norm)) continue;
      out.push({ raw: raw, norm: norm, index: index, pct: /%$/.test(raw) });
    }
    return out;
  }
  function ids(text) {
    var out = [], m, s = String(text == null ? "" : text);
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(s)) !== null) out.push(m[0]);
    return out;
  }
  function countSymbol(text, sym) { return String(text || "").split(sym).length - 1; }
  function decimals(norm) { var i = norm.indexOf("."); return i < 0 ? 0 : norm.length - i - 1; }
  function around(text, index, len) {
    var s = String(text); var a = Math.max(0, index - 12), b = Math.min(s.length, index + len + 12);
    return (a > 0 ? "…" : "") + s.slice(a, b).replace(/\s+/g, " ") + (b < s.length ? "…" : "");
  }
  function numberedItems(text) {
    var m = String(text || "").match(/^\s*(?:\d{1,3}[.)]|[①-⑳]|[-*•])\s+\S/gm);
    return m ? m.length : 0;
  }
  function multiset(list) {
    var map = Object.create(null);
    list.forEach(function (x) { map[x] = (map[x] || 0) + 1; });
    return map;
  }

  /* 같은 값의 소수 자릿수가 줄었는지: 원문 0.9685245400 → 결과 0.96852454 (뒤의 0 생략 포함), 반올림 0.9685 등. */
  function looksTruncated(srcNorm, outNorm) {
    if (srcNorm === outNorm) return false;
    var sd = decimals(srcNorm), od = decimals(outNorm);
    if (od >= sd) return false;
    var si = srcNorm.split(".")[0];
    var oi = outNorm.split(".")[0];
    if (si !== oi) {
      // 반올림으로 정수부가 올라간 경우(0.9999 → 1)는 제외하고 자릿수 손실로만 본다
      return false;
    }
    var sf = (srcNorm.split(".")[1] || ""), of = (outNorm.split(".")[1] || "");
    return of.length > 0 && sf.indexOf(of) === 0; // 앞부분이 같고 뒤가 잘림
  }
  function looksRounded(srcNorm, outNorm) {
    var sd = decimals(srcNorm), od = decimals(outNorm);
    if (od >= sd || sd === 0) return false;
    var a = Number(srcNorm), b = Number(outNorm);
    if (!isFinite(a) || !isFinite(b)) return false;
    var step = Math.pow(10, -od);
    return Math.abs(a - b) <= step / 2 + 1e-12 && srcNorm !== outNorm;
  }

  /* source(원문), output(AI 결과·보고) -> { findings, stats } */
  function check(source, output, options) {
    var opt = options || {};
    var src = String(source == null ? "" : source), out = String(output == null ? "" : output);
    var findings = [];
    function add(type, severity, message, srcEvidence, outEvidence) {
      findings.push({ type: type, severity: severity, message: message, source: srcEvidence || "", output: outEvidence || "" });
    }
    var MAX = 300000;
    if (src.length > MAX || out.length > MAX) {
      return { ok: false, error: "입력이 너무 깁니다(각각 " + MAX.toLocaleString("en-US") + "자까지). 나눠서 넣어 주세요.", findings: [], stats: { sourceNumbers: 0, preservedNumbers: 0, coverage: null } };
    }
    if (!src.trim() || !out.trim()) {
      return { ok: false, error: "원문과 AI 결과를 모두 넣어야 대조할 수 있습니다.", findings: [], stats: { sourceNumbers: 0, preservedNumbers: 0, coverage: null } };
    }

    var sn = numbers(src, true), on = numbers(out, true);
    var outCount = multiset(on.map(function (n) { return n.norm; }));
    var used = Object.create(null);
    var preserved = 0, reportedLoss = 0, lossOut = Object.create(null);
    var sevNum = opt.strictNumbers ? "high" : "high";
    var outNormList = on.map(function (n) { return n.norm; });

    var outDigits = out.replace(/[^0-9]/g, "");
    sn.forEach(function (n) {
      var key = n.norm;
      var avail = (outCount[key] || 0) - (used[key] || 0);
      if (avail > 0) { used[key] = (used[key] || 0) + 1; preserved++; return; }
      /* 전화번호처럼 하이픈·공백만 달라진 경우: 숫자열이 결과의 숫자 흐름 안에 그대로 있으면 서식 차이로 본다 */
      if (!/[.]/.test(key) && key.replace(/\D/g, "").length >= 3 && outDigits.indexOf(key.replace(/\D/g, "")) >= 0 && n.raw.replace(/\D/g, "") === key.replace(/\D/g, "")) { preserved++; return; }
      /* 정확히 같은 값이 없을 때: 자릿수 손실/반올림/완전 누락 구분 */
      var trunc = null, rounded = null;
      for (var i = 0; i < on.length; i++) {
        if (looksTruncated(key, on[i].norm)) { trunc = on[i]; break; }
        if (!rounded && looksRounded(key, on[i].norm)) rounded = on[i];
      }
      if (trunc || rounded) {
        var o = trunc || rounded;
        var same = Number(key) === Number(o.norm);
        if (same) {
          add("표기 변환(값은 같음)", "low",
            "원문의 " + n.raw + " 이(가) 결과에서 " + o.raw + " 로 적혔습니다(값은 같고 끝자리 표기만 다름). 원문을 글자 그대로 옮겨야 하는 자료(코드, 식별자, 정밀도 표기)라면 확인하세요.",
            around(src, n.index, n.raw.length), around(out, o.index, o.raw.length));
        } else {
          add(trunc ? "소수 자릿수 손실" : "반올림·자릿수 변경", "high",
            "원문의 " + n.raw + " 이(가) 결과에서 " + o.raw + " 로 바뀌었습니다(소수 자릿수 " + decimals(key) + "→" + decimals(o.norm) + ", 값이 달라짐).",
            around(src, n.index, n.raw.length), around(out, o.index, o.raw.length));
        }
        reportedLoss++; lossOut[o.index] = true;
      } else {
        add("숫자 누락 또는 변경", sevNum,
          "원문의 숫자 " + n.raw + " 이(가) 결과에 없습니다. 빠졌거나 다른 값으로 바뀌었을 수 있습니다(요약·계산으로 일부러 바꾼 값이면 정상).",
          around(src, n.index, n.raw.length), "");
      }
    });

    /* 원문에 없던 새 숫자(결과에서 만들어졌거나 오독으로 생긴 값) */
    var srcCount = multiset(sn.map(function (n) { return n.norm; }));
    var usedOut = Object.create(null);
    var extra = [];
    on.forEach(function (n) {
      if (lossOut[n.index]) return;
      var avail = (srcCount[n.norm] || 0) - (usedOut[n.norm] || 0);
      if (avail > 0) usedOut[n.norm] = (usedOut[n.norm] || 0) + 1;
      else extra.push(n);
    });
    if (extra.length) {
      var shown = extra.slice(0, 5).map(function (n) { return n.raw; }).join(", ");
      add("원문에 없는 숫자", "low",
        "결과에 원문에 없는 숫자가 " + extra.length + "개 있습니다(" + shown + (extra.length > 5 ? " 외" : "") + "). 계산·집계 결과일 수도 있고 오독으로 생긴 값일 수도 있어 확인이 필요합니다.",
        "", around(out, extra[0].index, extra[0].raw.length));
    }

    /* ID·코드 */
    var sids = ids(src), oids = multiset(ids(out)), usedId = Object.create(null);
    var missingIds = [];
    sids.forEach(function (id) {
      var avail = (oids[id] || 0) - (usedId[id] || 0);
      if (avail > 0) usedId[id] = (usedId[id] || 0) + 1; else if (missingIds.indexOf(id) < 0) missingIds.push(id);
    });
    if (missingIds.length) {
      add("ID·코드 누락", "high", "원문의 ID·코드 " + missingIds.slice(0, 8).join(", ") + (missingIds.length > 8 ? " 외 " + (missingIds.length - 8) + "개" : "") + " 이(가) 결과에 없습니다.", missingIds.slice(0, 3).join(", "), "");
    }

    /* 기호 */
    SYMBOLS.forEach(function (sym) {
      var a = countSymbol(src, sym), b = countSymbol(out, sym);
      if (a > 0 && b === 0) add("기호 누락", "high", "원문에 있는 기호 '" + sym + "' (" + a + "회)가 결과에 하나도 없습니다. 다른 기호나 말로 바뀌었을 수 있습니다.", sym + " x" + a, "");
      else if (a > 0 && b < a && (sym !== "=" && sym !== "<" && sym !== ">" && sym !== "%")) add("기호 감소", "mid", "기호 '" + sym + "' 가 원문 " + a + "회, 결과 " + b + "회입니다.", sym + " x" + a, sym + " x" + b);
    });
    // 부등호 방향 뒤바뀜 의심: 원문엔 ≤ 만, 결과엔 ≥ 만
    [["≤", "≥"], ["<", ">"]].forEach(function (pair) {
      var a1 = countSymbol(src, pair[0]), a2 = countSymbol(src, pair[1]), b1 = countSymbol(out, pair[0]), b2 = countSymbol(out, pair[1]);
      if (a1 > 0 && a2 === 0 && b1 === 0 && b2 > 0) add("기호 방향 변경 의심", "high", "원문은 '" + pair[0] + "' 만 쓰는데 결과는 '" + pair[1] + "' 만 씁니다.", pair[0] + " x" + a1, pair[1] + " x" + b2);
      if (a2 > 0 && a1 === 0 && b2 === 0 && b1 > 0) add("기호 방향 변경 의심", "high", "원문은 '" + pair[1] + "' 만 쓰는데 결과는 '" + pair[0] + "' 만 씁니다.", pair[1] + " x" + a2, pair[0] + " x" + b1);
    });

    /* 항목 수 */
    var si = numberedItems(src), oi = numberedItems(out);
    if (si >= 3 && oi > 0 && oi < si) add("항목 수 불일치", "high", "원문의 번호·글머리 항목이 " + si + "개인데 결과는 " + oi + "개입니다. 일부가 빠졌을 수 있습니다.", si + "개", oi + "개");
    var sLines = src.split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
    var oLines = out.split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
    if (sLines >= 8 && oLines * 2 < sLines && !(si >= 3)) add("분량 크게 줄어듦", "mid", "원문 " + sLines + "줄에 비해 결과가 " + oLines + "줄입니다. 요약이 목적이면 정상이고, 전체 옮기기가 목적이면 누락을 의심하세요.", sLines + "줄", oLines + "줄");

    /* 완료 주장 표현 */
    var claim = /(모두|전부|빠짐없이|남김없이|완료|끝냈|통과|100\s*%)/.test(out);
    var seriousCount = findings.filter(function (f) { return f.severity === "high"; }).length;
    if (claim && seriousCount > 0) add("완료 주장과 불일치", "high", "결과에 '완료·모두·빠짐없이' 같은 표현이 있는데, 위에서 심각한 불일치가 " + seriousCount + "건 나왔습니다. 완료 보고와 실제 확인 결과가 어긋날 수 있다는 신호입니다.", "", out.match(/.{0,12}(모두|전부|빠짐없이|남김없이|완료|끝냈|통과|100\s*%).{0,12}/)[0]);

    var order = { high: 0, mid: 1, low: 2 };
    findings.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
    return {
      ok: true,
      findings: findings,
      stats: { sourceNumbers: sn.length, preservedNumbers: preserved, coverage: sn.length ? preserved / sn.length : null,
               sourceIds: sids.length, sourceItems: si, resultItems: oi, high: seriousCount },
      limits: "글자·숫자·기호·ID·항목 수 수준의 대조입니다. 의미, 계산의 옳음, 요구사항 이해는 확인하지 못하며 '찾지 못함'이 '문제 없음'은 아닙니다."
    };
  }

  /* 자동 신호: 지적 건수로 '검토 필요' 초기값만 정한다. 확신도는 지어내지 않는다(null).
   * 사람이 확인하기 전의 신호이며 AI의 재검토가 아니다. */
  function autoSignal(result) {
    if (!result || !result.ok) return { needs_review: true, reason_type: "shortage", confidence: null };
    var high = result.stats.high || 0;
    var mid = result.findings.filter(function (f) { return f.severity === "mid"; }).length;
    if (high > 0) return { needs_review: true, reason_type: "specific", confidence: null };
    if (mid > 0) return { needs_review: true, reason_type: "shortage", confidence: null };
    return { needs_review: false, reason_type: "none", confidence: null };
  }

  return { check: check, autoSignal: autoSignal, numbers: numbers, ids: ids };
});
