/* 화면 동작. 사용자 입력은 textContent 로만 넣고, 모든 계산은 logic.js 가 한다. */
(function () {
  "use strict";
  var RS = window.ReviewSignal;
  var MODELS = window.PAPER_MODELS || [];
  var CASES = window.PAPER_CASES || [];
  var rows = [];
  var focusKey = null;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function blankRow() { return { memo: "", requested: "", reason: "", actual: "", confidence: null, reviewer: "same" }; }
  function isBlank(r) { return !r.requested && !r.actual && !r.memo && r.confidence === null; }

  function select(options, value, label, onChange, disabled, key) {
    var s = el("select", { "aria-label": label, "data-key": key });
    options.forEach(function (o) {
      var op = el("option", { value: o[0] }, o[1]);
      if (o[0] === value) op.selected = true;
      s.appendChild(op);
    });
    s.disabled = !!disabled;
    s.addEventListener("change", function () { focusKey = key; onChange(s.value); });
    return s;
  }

  function renderRows() {
    var tb = document.querySelector("#rows tbody");
    tb.textContent = "";
    rows.forEach(function (row, i) {
      var n = i + 1;
      var tr = el("tr");
      tr.appendChild(el("td", { "data-label": "번호" }, String(n)));

      var memo = el("input", { type: "text", maxlength: "60", placeholder: "예: 견적서 표", "aria-label": n + "번 메모" });
      memo.value = row.memo;
      memo.addEventListener("input", function () { row.memo = memo.value; });
      var td1 = el("td", { "data-label": "메모" }); td1.appendChild(memo); tr.appendChild(td1);

      var td2 = el("td", { "data-label": "검토 필요?" });
      td2.appendChild(select([["", "선택"], ["yes", "예"], ["no", "아니오"]], row.requested, n + "번 재검토의 검토 필요 여부", function (v) {
        row.requested = v; if (v !== "yes") row.reason = ""; update(true);
      }, false, i + ":req"));
      tr.appendChild(td2);

      var conf = el("input", { type: "number", min: "0", max: "100", step: "1", placeholder: "0~100", "aria-label": n + "번 확신도(0~100, 선택)" });
      conf.value = row.confidence === null ? "" : String(row.confidence);
      conf.addEventListener("change", function () {
        var v = conf.value.trim();
        if (v === "" || isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100) { row.confidence = null; conf.value = ""; }
        else row.confidence = Math.round(Number(v));
        update(false);
      });
      var tdc = el("td", { "data-label": "확신도" }); tdc.appendChild(conf); tr.appendChild(tdc);

      var td3 = el("td", { "data-label": "근거" });
      td3.appendChild(select([["", "선택"], ["shortage", "검산 부족"], ["specific", "구체적 오류 지적"], ["none", "근거 없음"]], row.reason, n + "번 근거 유형", function (v) {
        row.reason = v; update(false);
      }, row.requested !== "yes", i + ":rea"));
      tr.appendChild(td3);

      var td4 = el("td", { "data-label": "실제 결과(내가 확인)" });
      td4.appendChild(select([["", "선택"], ["correct", "정답"], ["wrong", "오답"]], row.actual, n + "번 실제 결과", function (v) {
        row.actual = v; update(false);
      }, false, i + ":act"));
      tr.appendChild(td4);

      var td6 = el("td", { "data-label": "재검토한 쪽" });
      td6.appendChild(select([["same", "같은 AI"], ["other", "다른 AI"], ["human", "사람"], ["auto", "자동 대조(앱)"]], row.reviewer, n + "번 재검토한 쪽", function (v) {
        row.reviewer = v; update(false);
      }, false, i + ":rev"));
      tr.appendChild(td6);

      var td5 = el("td", { "data-label": "" });
      var del = el("button", { type: "button", class: "ghost small", "aria-label": n + "번 줄 삭제" }, "삭제");
      del.addEventListener("click", function () { focusKey = null; rows.splice(i, 1); if (!rows.length) rows.push(blankRow()); update(true); });
      td5.appendChild(del); tr.appendChild(td5);
      tb.appendChild(tr);
    });
    if (focusKey) {
      var t = document.querySelector('#rows [data-key="' + focusKey + '"]');
      if (t && !t.disabled) t.focus();
      focusKey = null;
    }
  }

  function stat(label, value, sub) {
    var d = el("div", { class: "stat" });
    d.appendChild(el("div", { class: "v" }, value));
    d.appendChild(el("div", { class: "l" }, label));
    if (sub) d.appendChild(el("div", { class: "sub" }, sub));
    return d;
  }

  function renderResult() {
    var box = $("result");
    box.textContent = "";
    var s = RS.summarize(rows);
    var grid = el("div", { class: "stats" });
    grid.appendChild(stat("오답 검토율", RS.pct(s.errReview), "실제 오답 " + s.wrongN + "건 중 재검토가 검토 요청 " + s.tp + "건"));
    grid.appendChild(stat("정답 검토율", RS.pct(s.rightReview), "실제 정답 " + s.rightN + "건 중 재검토가 검토 요청 " + s.fp + "건"));
    var big = stat("균형정확도", RS.pct(s.balanced), s.balanced === null ? "(오답 검토율 + 1 − 정답 검토율) / 2" : "흔들릴 수 있는 범위 약 " + RS.range(s.balancedCI));
    big.classList.add("main");
    grid.appendChild(big);
    grid.appendChild(stat("Brier 점수", s.brier === null ? "확신도 없음" : s.brier.toFixed(3), s.brier === null ? "확신도를 적으면 계산됩니다" : "확신도를 적은 " + s.brierN + "건, 낮을수록 좋음"));
    box.appendChild(grid);

    var m = el("table", { class: "matrix", "aria-label": "재검토와 실제 결과의 4칸 표" });
    var head = el("tr"); ["", "재검토: 검토 필요", "재검토: 검토 불필요"].forEach(function (t) { head.appendChild(el("th", null, t)); });
    var r1 = el("tr"); r1.appendChild(el("th", null, "실제 오답")); r1.appendChild(el("td", null, "검토 요청이 맞음 " + s.tp + "건")); r1.appendChild(el("td", { class: s.fn ? "bad" : "" }, "놓침 " + s.fn + "건"));
    var r2 = el("tr"); r2.appendChild(el("th", null, "실제 정답")); r2.appendChild(el("td", null, "정답인데 검토 요청 " + s.fp + "건")); r2.appendChild(el("td", null, "검토 불필요가 맞음 " + s.tn + "건"));
    m.appendChild(head); m.appendChild(r1); m.appendChild(r2);
    box.appendChild(m);

    var g = RS.byReviewer(rows);
    var usedGroups = ["same", "other", "human", "auto"].filter(function (k) { return g[k].used > 0; });
    if (usedGroups.length > 1) {
      var p = el("p", { class: "help" });
      p.textContent = "재검토한 쪽별 균형정확도: " + usedGroups.map(function (k) { return RS.REVIEWER[k] + " " + g[k].used + "건 " + RS.pct(g[k].balanced); }).join(" / ") + ". 논문 비교는 '같은 AI' 기록에만 씁니다.";
      box.appendChild(p);
    }

    var ul = el("ul", { class: "notes" });
    RS.interpret(s).forEach(function (n) { ul.appendChild(el("li", { class: n.level }, n.text)); });
    box.appendChild(ul);

    $("result-json").textContent = JSON.stringify(RS.toJSON(rows, MODELS), null, 2);
    return g;
  }

  function renderCompare(g) {
    var box = $("compare");
    box.textContent = "";
    var mine = g.same;
    var items = MODELS.map(function (m) {
      return { name: m.name, provider: m.provider, value: RS.balancedOf(m), wrongN: m.tp + m.fn, mine: false };
    });
    if (mine.balanced !== null) items.push({ name: "내 기록(같은 AI)", provider: "", value: mine.balanced, wrongN: mine.wrongN, mine: true });
    var ok = items.filter(function (x) { return x.value !== null; }).sort(function (a, b) { return b.value - a.value; });
    var no = items.filter(function (x) { return x.value === null; });
    box.appendChild(el("h3", null, "논문의 모델 " + MODELS.length + "종과 비교(같은 AI가 자기 결과를 다시 평가한 기록만)"));
    var cmp = RS.compare(mine.balanced, MODELS);
    if (mine.balanced === null) box.appendChild(el("p", { class: "help" }, "'같은 AI' 기록에 실제 정답과 오답이 모두 있으면 아래 막대 사이에 '내 기록'이 끼어듭니다. 지금은 논문 결과만 보입니다."));
    else box.appendChild(el("p", { class: "help" }, "계산할 수 있었던 모델 " + cmp.usableCount + "종 중 " + cmp.below + "종보다 높고 " + cmp.above + "종보다 낮습니다(같은 값 " + cmp.same + "종). 논문 모델은 문항 12개, 오답 1~6개 기준이고 실행 환경도 달라 단순 순위로 읽지 마세요."));
    var list = el("ul", { class: "bars" });
    ok.forEach(function (x) {
      var li = el("li", { class: x.mine ? "mine" : "" });
      li.appendChild(el("span", { class: "name" }, x.name + (x.provider ? " (" + x.provider + ")" : "")));
      var track = el("span", { class: "track" });
      var fill = el("span", { class: "fill" }); fill.style.width = Math.round(x.value * 100) + "%";
      track.appendChild(fill);
      li.appendChild(track);
      li.appendChild(el("span", { class: "val" }, RS.pct(x.value) + " · 오답 " + x.wrongN + "건"));
      list.appendChild(li);
    });
    box.appendChild(list);
    if (no.length) box.appendChild(el("p", { class: "help" }, "계산 불가(정답 또는 오답이 0건): " + no.map(function (x) { return x.name; }).join(", ") + ". 논문도 이 모델들은 균형정확도를 비교하지 못했습니다."));
  }

  /* ----- 더 해 보기: 논문 사례 ----- */
  var picks = {};
  var LABEL = { keep: "처음 답", change: "AI의 수정안", both: "처음 답도 수정안도 틀림" };
  function renderCases() {
    var box = $("cases");
    box.textContent = "";
    CASES.forEach(function (c, idx) {
      var card = el("article", { class: "case" });
      card.appendChild(el("h3", null, "사례 " + (idx + 1) + " · " + c.model));
      card.appendChild(el("p", null, c.task));
      card.appendChild(el("p", { class: "q" }, c.first));
      card.appendChild(el("p", { class: "q" }, c.review));
      var group = el("div", { class: "choices", role: "group", "aria-label": "사례 " + (idx + 1) + " 선택" });
      [["keep", "처음 답이 맞다"], ["change", "AI의 수정안이 맞다"], ["both", "둘 다 틀렸을 수 있다"]].forEach(function (o) {
        var b = el("button", { type: "button", class: "ghost" + (picks[c.id] === o[0] ? " chosen" : "") }, o[1]);
        b.disabled = !!picks[c.id];
        b.addEventListener("click", function () { picks[c.id] = o[0]; renderCases(); });
        group.appendChild(b);
      });
      card.appendChild(group);
      if (picks[c.id]) {
        var p = picks[c.id];
        var res = el("div", { class: "reveal " + (p === c.right ? "ok" : "bad") });
        res.appendChild(el("b", null, p === c.right ? "맞았습니다." : "이번에는 달랐습니다. 논문이 확인한 정답: " + LABEL[c.right] + "."));
        res.appendChild(el("p", null, c.why));
        card.appendChild(res);
      }
      box.appendChild(card);
    });
    var done = CASES.filter(function (c) { return picks[c.id]; }).length;
    var right = CASES.filter(function (c) { return picks[c.id] === c.right; }).length;
    var sc = $("case-score");
    sc.textContent = "";
    if (done === 0) return;
    if (done < CASES.length) { sc.textContent = done + "/" + CASES.length + "개 선택함"; return; }
    sc.appendChild(el("span", null, "맞힌 사례 " + right + "/" + CASES.length + ". 논문이 고른 6개 사례에서는 처음 답이 맞은 경우 3개, 수정안이 맞은 경우 2개, 둘 다 틀린 경우 1개였습니다. 이 비율을 일반화하지는 마세요. 재검토는 틀릴 때도 맞을 때도 있어서, 수정안을 적용하기 전에 원래 결과와 같은 기준으로 다시 확인하는 것이 논문의 교훈입니다. "));
    var again = el("button", { type: "button", class: "ghost small" }, "다시 해 보기");
    again.addEventListener("click", function () { picks = {}; renderCases(); });
    sc.appendChild(again);
  }

  function update(rerenderRows) {
    if (rerenderRows) renderRows();
    renderCompare(renderResult());
  }

  /* 가상의 예시 14건(확신도 포함). 실제 기록이 아니다. */
  var EXAMPLE = [
    ["yes", "specific", 35, "wrong"], ["yes", "shortage", 55, "correct"], ["no", "none", 92, "correct"], ["yes", "specific", 20, "wrong"],
    ["no", "none", 88, "correct"], ["no", "none", 80, "wrong"], ["yes", "shortage", 45, "wrong"], ["no", "none", 95, "correct"],
    ["yes", "specific", 10, "correct"], ["no", "none", 90, "correct"], ["yes", "shortage", 50, "wrong"], ["no", "none", 85, "correct"],
    ["yes", "specific", 30, "wrong"], ["no", "none", 93, "correct"]
  ];

  /* LLM·다른 프로그램이 쓰는 입구: window.reviewSignalScore({lines|records}) -> 결과 JSON */
  function scoreFromArgs(args) {
    var list = [], skipped = [];
    if (args && Array.isArray(args.records)) list = args.records;
    else if (args && typeof args.lines === "string") { var p = RS.parseLines(args.lines); list = p.rows; skipped = p.problems; }
    var out = RS.toJSON(list, MODELS);
    out.skippedLines = skipped;
    return out;
  }
  window.reviewSignalScore = scoreFromArgs;

  /* WebMCP(웹페이지가 도구를 에이전트에게 알리는 W3C 커뮤니티 그룹 제안)를 브라우저가 지원할 때만 등록한다.
   * 진입점은 document.modelContext(현재 명세), 이전 초안은 navigator.modelContext. 없으면 조용히 넘어간다. */
  function registerWebMCP() {
    try {
      var mc = (typeof document !== "undefined" && document.modelContext) || (typeof navigator !== "undefined" && navigator.modelContext);
      if (!mc || typeof mc.registerTool !== "function") return;
      mc.registerTool({
        name: "score_review_signal",
        description: "AI 재검토의 '검토 필요' 신호가 실제 오류를 얼마나 가려냈는지 논문 3.4절의 균형정확도로 계산한다. lines는 줄마다 '예, 구체적 오류 지적, 오답' 형식, records는 {requested, reason, actual, confidence} 배열.",
        inputSchema: { type: "object", properties: { lines: { type: "string" }, records: { type: "array", items: { type: "object" } } } },
        execute: function (input) { return Promise.resolve(scoreFromArgs(input || {})); }
      });
    } catch (e) { /* 지원하지 않는 환경: 무시 */ }
  }

  function loadFromUrl() {
    try {
      var q = new URLSearchParams(location.search).get("lines");
      if (!q) return false;
      var p = RS.parseLines(q);
      if (!p.rows.length) return false;
      rows = p.rows.map(function (r, i) { r.memo = "주소에서 불러옴 " + (i + 1); return r; });
      return true;
    } catch (e) { return false; }
  }

  function init() {
    rows = [blankRow(), blankRow(), blankRow()];
    $("btn-prompt").addEventListener("click", function () {
      $("prompt-out").value = RS.buildPrompt($("req-text").value, $("res-text").value);
      $("copy-msg").textContent = "프롬프트를 만들었습니다. 복사 버튼을 누르세요.";
    });
    $("btn-copy").addEventListener("click", function () {
      var ta = $("prompt-out");
      if (!ta.value) { $("btn-prompt").click(); }
      ta.select();
      var done = false;
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      var finish = function (ok) { $("copy-msg").textContent = ok ? "복사했습니다." : "자동 복사가 막혔습니다. 칸을 눌러 전체 선택 후 복사하세요."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { finish(true); }, function () { finish(done); });
      else finish(done);
    });
    var lastAuto = null;
    $("btn-autocheck").addEventListener("click", function () {
      var box = $("autocheck-out");
      box.textContent = "";
      var r = window.SourceCheck.check($("req-text").value, $("res-text").value);
      lastAuto = r.ok ? r : null;
      $("btn-autoadd").disabled = !r.ok;
      if (!r.ok) { box.appendChild(el("p", { class: "problems" }, r.error)); return; }
      var sg = window.SourceCheck.autoSignal(r);
      box.appendChild(el("p", { class: "help" }, "원문 숫자 " + r.stats.sourceNumbers + "개 중 " + r.stats.preservedNumbers + "개가 결과에 그대로 있습니다. 자동 신호: " + (sg.needs_review ? "검토 필요(" + (sg.reason_type === "specific" ? "구체적 오류 지적" : "검산 부족") + ")" : "검토 불필요") + ", 확신도 " + sg.confidence + "(사람이 확인하기 전의 초기값)."));
      if (!r.findings.length) box.appendChild(el("p", { class: "notes-ok" }, "글자·숫자 수준에서는 불일치를 찾지 못했습니다. 의미와 계산은 아직 확인되지 않았습니다."));
      var ul = el("ul", { class: "notes" });
      r.findings.forEach(function (f) {
        var li = el("li", { class: f.severity === "high" ? "bad" : (f.severity === "mid" ? "mid" : "info") });
        li.appendChild(el("b", null, f.type + " "));
        li.appendChild(document.createTextNode(f.message));
        if (f.source || f.output) li.appendChild(el("div", { class: "sub" }, (f.source ? "원문: " + f.source : "") + (f.source && f.output ? "  →  " : "") + (f.output ? "결과: " + f.output : "")));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      box.appendChild(el("p", { class: "help" }, r.limits));
    });
    $("btn-autoadd").addEventListener("click", function () {
      if (!lastAuto) return;
      var sg = window.SourceCheck.autoSignal(lastAuto);
      rows = rows.filter(function (r) { return !isBlank(r); }).concat([{ memo: "자동 원문 대조", requested: sg.needs_review ? "yes" : "no", reason: sg.needs_review ? sg.reason_type : "", actual: "", confidence: sg.confidence, reviewer: "auto" }]);
      update(true);
      $("btn-autoadd").disabled = true;
    });
    $("btn-addjson").addEventListener("click", function () {
      var p = RS.parseAiJson($("ai-json").value, $("reviewer-new").value);
      var ul = $("json-problems");
      ul.textContent = "";
      p.problems.forEach(function (x) { ul.appendChild(el("li", null, x.why)); });
      if (p.rows.length) {
        rows = rows.filter(function (r) { return !isBlank(r); }).concat(p.rows);
        ul.appendChild(el("li", { class: "okline" }, p.rows.length + "건을 추가했습니다. 이제 원문과 대조해 '실제 결과'를 고르세요."));
        $("ai-json").value = "";
        update(true);
      }
    });
    $("btn-example").addEventListener("click", function () {
      rows = EXAMPLE.map(function (e, i) { return { memo: "예시 " + (i + 1), requested: e[0], reason: e[0] === "yes" ? e[1] : "", actual: e[3], confidence: e[2], reviewer: "same" }; });
      update(true);
    });
    $("btn-add").addEventListener("click", function () { rows.push(blankRow()); update(true); });
    $("btn-clear").addEventListener("click", function () { rows = [blankRow(), blankRow(), blankRow()]; $("paste-problems").textContent = ""; $("json-problems").textContent = ""; update(true); });
    $("btn-paste").addEventListener("click", function () {
      var p = RS.parseLines($("paste-text").value);
      var ul = $("paste-problems");
      ul.textContent = "";
      p.problems.forEach(function (x) { ul.appendChild(el("li", null, x.line + "번째 줄을 건너뜀: " + x.why)); });
      if (p.rows.length) {
        rows = rows.filter(function (r) { return !isBlank(r); }).concat(p.rows);
        ul.appendChild(el("li", { class: "okline" }, p.rows.length + "줄을 추가했습니다."));
        update(true);
      } else if (!p.problems.length) ul.appendChild(el("li", null, "붙여넣을 줄이 없습니다."));
    });
    loadFromUrl();
    update(true);
    renderCases();
    registerWebMCP();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
