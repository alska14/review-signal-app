/* 화면 동작. 사용자 입력은 textContent 로만 넣고, 모든 계산은 logic.js 가 한다. */
(function () {
  "use strict";
  var RS = window.ReviewSignal;
  var MODELS = window.PAPER_MODELS || [];
  var CASES = window.PAPER_CASES || [];
  var rows = [];

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") return;
      else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function blankRow() { return { memo: "", requested: "", reason: "", actual: "" }; }

  function select(options, value, label, onChange, disabled) {
    var s = el("select", { "aria-label": label });
    options.forEach(function (o) {
      var op = el("option", { value: o[0] }, o[1]);
      if (o[0] === value) op.selected = true;
      s.appendChild(op);
    });
    s.disabled = !!disabled;
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  function renderRows() {
    var tb = document.querySelector("#rows tbody");
    tb.textContent = "";
    rows.forEach(function (row, i) {
      var tr = el("tr");
      tr.appendChild(el("td", { "data-label": "번호" }, String(i + 1)));
      var memo = el("input", { type: "text", maxlength: "60", placeholder: "예: 견적서 요약", "aria-label": (i + 1) + "번 메모" });
      memo.value = row.memo;
      memo.addEventListener("input", function () { row.memo = memo.value; });
      var td1 = el("td", { "data-label": "메모" }); td1.appendChild(memo); tr.appendChild(td1);

      var td2 = el("td", { "data-label": "AI가 검토 필요라고 했나요?" });
      td2.appendChild(select([["", "선택"], ["yes", "예"], ["no", "아니오"]], row.requested, (i + 1) + "번 AI 검토 요청", function (v) {
        row.requested = v; if (v !== "yes") row.reason = ""; update(true);
      }));
      tr.appendChild(td2);

      var td3 = el("td", { "data-label": "그 근거" });
      td3.appendChild(select([["", "선택"], ["shortage", "검산 부족"], ["specific", "구체적 오류 지적"], ["none", "근거 없음"]], row.reason, (i + 1) + "번 근거", function (v) {
        row.reason = v; update(false);
      }, row.requested !== "yes"));
      tr.appendChild(td3);

      var td4 = el("td", { "data-label": "실제 결과" });
      td4.appendChild(select([["", "선택"], ["correct", "정답"], ["wrong", "오답"]], row.actual, (i + 1) + "번 실제 결과", function (v) {
        row.actual = v; update(false);
      }));
      tr.appendChild(td4);

      var td5 = el("td", { "data-label": "" });
      var del = el("button", { type: "button", class: "ghost small", "aria-label": (i + 1) + "번 줄 삭제" }, "삭제");
      del.addEventListener("click", function () { rows.splice(i, 1); if (!rows.length) rows.push(blankRow()); update(true); });
      td5.appendChild(del); tr.appendChild(td5);
      tb.appendChild(tr);
    });
  }

  function stat(label, value, sub) {
    var d = el("div", { class: "stat" });
    d.appendChild(el("div", { class: "v" }, value));
    d.appendChild(el("div", { class: "l" }, label));
    if (sub) d.appendChild(el("div", { class: "sub" }, sub));
    return d;
  }

  function renderResult() {
    var box = document.getElementById("result");
    box.textContent = "";
    var s = RS.summarize(rows);
    var grid = el("div", { class: "stats" });
    grid.appendChild(stat("오답 검토율", RS.pct(s.errReview), "실제 오답 " + s.wrongN + "건 중 AI가 검토 요청 " + s.tp + "건"));
    grid.appendChild(stat("정답 검토율", RS.pct(s.rightReview), "실제 정답 " + s.rightN + "건 중 AI가 검토 요청 " + s.fp + "건"));
    var big = stat("균형정확도", RS.pct(s.balanced), "(오답 검토율 + 1 − 정답 검토율) / 2");
    big.classList.add("main");
    grid.appendChild(big);
    box.appendChild(grid);

    var m = el("table", { class: "matrix", "aria-label": "검토 요청과 실제 결과의 4칸 표" });
    m.innerHTML = "";
    var head = el("tr"); ["", "AI: 검토 필요", "AI: 검토 불필요"].forEach(function (t) { head.appendChild(el("th", null, t)); });
    var r1 = el("tr"); r1.appendChild(el("th", null, "실제 오답")); r1.appendChild(el("td", null, "맞게 잡음 " + s.tp + "건")); r1.appendChild(el("td", { class: s.fn ? "bad" : "" }, "놓침 " + s.fn + "건"));
    var r2 = el("tr"); r2.appendChild(el("th", null, "실제 정답")); r2.appendChild(el("td", null, "헛 경보 " + s.fp + "건")); r2.appendChild(el("td", null, "맞게 통과 " + s.tn + "건"));
    m.appendChild(head); m.appendChild(r1); m.appendChild(r2);
    box.appendChild(m);

    var ul = el("ul", { class: "notes" });
    RS.interpret(s).forEach(function (n) { ul.appendChild(el("li", { class: n.level }, n.text)); });
    box.appendChild(ul);
    return s;
  }

  function renderCompare(s) {
    var box = document.getElementById("compare");
    box.textContent = "";
    var items = MODELS.map(function (m) {
      return { name: m.name, provider: m.provider, value: RS.balancedOf(m), wrongN: m.tp + m.fn, rightN: m.fp + m.tn, brier: m.brier, mine: false };
    });
    if (s.balanced !== null) items.push({ name: "내 기록", provider: "", value: s.balanced, wrongN: s.wrongN, rightN: s.rightN, mine: true });
    var ok = items.filter(function (x) { return x.value !== null; }).sort(function (a, b) { return b.value - a.value; });
    var no = items.filter(function (x) { return x.value === null; });
    box.appendChild(el("h3", null, "논문의 모델 " + MODELS.length + "종과 비교"));
    var cmp = RS.compare(s.balanced, MODELS);
    if (s.balanced === null) box.appendChild(el("p", { class: "help" }, "내 점수가 계산되면 아래 막대 사이에 '내 기록'이 끼어듭니다. 지금은 논문 결과만 보입니다."));
    else box.appendChild(el("p", { class: "help" }, "계산할 수 있었던 모델 " + cmp.usableCount + "종 중 " + cmp.below + "종보다 높고 " + cmp.above + "종보다 낮습니다(같은 값 " + cmp.same + "종). 논문 모델은 문항 12개, 오답 1~6개 기준이라 단순 순위로 읽지 마세요."));
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

  /* ----- 3단계: 논문 사례 ----- */
  var picks = {};
  function renderCases() {
    var box = document.getElementById("cases");
    box.textContent = "";
    CASES.forEach(function (c, idx) {
      var card = el("article", { class: "case" });
      card.appendChild(el("h3", null, "사례 " + (idx + 1) + " · " + c.model));
      card.appendChild(el("p", null, c.task));
      card.appendChild(el("p", { class: "q" }, c.first));
      card.appendChild(el("p", { class: "q" }, c.review));
      var group = el("div", { class: "choices", role: "group", "aria-label": "사례 " + (idx + 1) + " 선택" });
      [["keep", "처음 답을 유지한다"], ["change", "AI의 수정안으로 바꾼다"], ["hold", "둘 다 검산하기 전에는 결정하지 않는다"]].forEach(function (o) {
        var b = el("button", { type: "button", class: "ghost" + (picks[c.id] === o[0] ? " chosen" : "") }, o[1]);
        b.disabled = !!picks[c.id];
        b.addEventListener("click", function () { picks[c.id] = o[0]; renderCases(); });
        group.appendChild(b);
      });
      card.appendChild(group);
      if (picks[c.id]) {
        var p = picks[c.id];
        var verdict;
        if (p === "hold") verdict = "보류는 안전한 첫걸음입니다. 검산 결과 정답은 " + (c.right === "keep" ? "처음 답" : "AI의 수정안") + "이었습니다.";
        else if (p === c.right) verdict = "맞았습니다.";
        else verdict = "이번에는 반대였습니다. 정답은 " + (c.right === "keep" ? "처음 답" : "AI의 수정안") + "이었습니다.";
        var res = el("div", { class: "reveal " + (p === c.right ? "ok" : (p === "hold" ? "mid" : "bad")) });
        res.appendChild(el("b", null, verdict));
        res.appendChild(el("p", null, c.why));
        card.appendChild(res);
      }
      box.appendChild(card);
    });
    var done = CASES.filter(function (c) { return picks[c.id]; }).length;
    var right = CASES.filter(function (c) { return picks[c.id] === c.right; }).length;
    var sc = document.getElementById("case-score");
    sc.textContent = done === 0 ? "" : (done < CASES.length ? done + "/" + CASES.length + "개 선택함" : "맞힌 사례 " + right + "/" + CASES.length + ". AI의 수정안은 4개 중 1개만 옳았고, 나머지는 처음 답이 맞았습니다. 그래서 수정안을 적용하기 전에 두 답을 같은 기준으로 다시 확인합니다.");
  }

  function update(rerenderRows) {
    if (rerenderRows) renderRows();
    var s = renderResult();
    renderCompare(s);
  }

  var EXAMPLE = [
    ["예", "구체적 오류 지적", "오답"], ["예", "검산 부족", "정답"], ["아니오", "", "정답"], ["예", "구체적 오류 지적", "오답"],
    ["아니오", "", "정답"], ["아니오", "", "오답"], ["예", "검산 부족", "오답"], ["아니오", "", "정답"], ["예", "구체적 오류 지적", "정답"],
    ["아니오", "", "정답"], ["예", "검산 부족", "오답"], ["아니오", "", "정답"], ["예", "구체적 오류 지적", "오답"], ["아니오", "", "정답"]
  ];

  function init() {
    rows = [blankRow(), blankRow(), blankRow()];
    document.getElementById("btn-example").addEventListener("click", function () {
      var text = EXAMPLE.map(function (r) { return r.filter(function (x, i) { return i !== 1 || x; }).join(", "); }).join("\n");
      var p = RS.parseLines(text);
      rows = p.rows.map(function (r, i) { r.memo = "예시 " + (i + 1); return r; });
      update(true);
    });
    document.getElementById("btn-add").addEventListener("click", function () { rows.push(blankRow()); update(true); });
    document.getElementById("btn-clear").addEventListener("click", function () { rows = [blankRow(), blankRow(), blankRow()]; document.getElementById("paste-problems").textContent = ""; update(true); });
    document.getElementById("btn-paste").addEventListener("click", function () {
      var p = RS.parseLines(document.getElementById("paste-text").value);
      var ul = document.getElementById("paste-problems");
      ul.textContent = "";
      p.problems.forEach(function (x) { ul.appendChild(el("li", null, x.line + "번째 줄을 건너뜀: " + x.why)); });
      if (p.rows.length) {
        rows = rows.filter(function (r) { return r.requested || r.actual || r.memo; }).concat(p.rows);
        ul.appendChild(el("li", { class: "okline" }, p.rows.length + "줄을 추가했습니다."));
        update(true);
      } else if (!p.problems.length) ul.appendChild(el("li", null, "붙여넣을 줄이 없습니다."));
    });
    update(true);
    renderCases();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
