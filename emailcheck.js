/* 이메일 형식 점검(브라우저·Node 공용). 가짜로 보이는 주소를 걸러 내지만 '진짜 사람의 주소'임을 증명하지는 못한다.
 * 실제 확인은 서버가 보낸 인증 메일의 링크를 눌러야 끝난다(keys/service.mjs). 이 파일은 DNS를 쓰지 않는다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EmailCheck = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* 자주 쓰이는 일회용·임시 메일 도메인(일부 목록). 목록에 없는 일회용 도메인은 통과할 수 있다. */
  var DISPOSABLE = ["mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la", "10minutemail.com", "10minutemail.net",
    "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "throwawaymail.com", "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.net", "getnada.com",
    "nada.email", "dispostable.com", "maildrop.cc", "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com", "spamgourmet.com", "mytemp.email",
    "tmpmail.org", "tmpmail.net", "burnermail.io", "moakt.com", "discard.email", "mailcatch.com", "inboxkitten.com", "tempinbox.com", "minuteinbox.com", "emailfake.com",
    "fakemail.net", "tempr.email", "anonbox.net", "spambox.us", "33mail.com", "jetable.org", "guerrillamailblock.com", "sneakemail.com", "linshiyouxiang.net", "mail.tm"];
  var RESERVED_DOMAINS = ["example.com", "example.org", "example.net", "test.com", "test.net", "domain.com", "email.com", "mail.com", "localhost", "invalid"];
  var RESERVED_TLDS = ["test", "invalid", "example", "localhost", "local", "internal", "lan", "home", "corp"];
  var FAKE_LOCALS = ["test", "tester", "testing", "asdf", "asdfgh", "qwerty", "fake", "fakemail", "none", "null", "nobody", "noemail", "no", "abc", "abcd", "abc123", "aaa", "aaaa", "xxx", "xxxx", "user", "username", "email", "admin", "root", "sample", "example", "demo", "temp", "temporary", "a", "aa", "x"];

  var LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i;
  var LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

  /* { ok, email(정규화), dedupeKey, reason, code } */
  function checkFormat(input) {
    var raw = typeof input === "string" ? input : "";
    var email = raw.trim().toLowerCase();
    function bad(code, reason) { return { ok: false, email: email, dedupeKey: null, code: code, reason: reason }; }
    if (!email) return bad("empty", "이메일을 입력하세요.");
    if (email.length > 254) return bad("too_long", "이메일이 너무 깁니다.");
    if (/\s/.test(email)) return bad("space", "이메일에 공백이 들어 있습니다.");
    var at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return bad("format", "이메일 형식이 아닙니다(이름@도메인).");
    var local = email.slice(0, at), domain = email.slice(at + 1);
    if (local.length > 64) return bad("local_long", "@ 앞부분이 너무 깁니다.");
    if (!LOCAL_RE.test(local) || local[0] === "." || local[local.length - 1] === "." || local.indexOf("..") >= 0) return bad("local_format", "@ 앞부분 형식이 올바르지 않습니다.");
    var labels = domain.split(".");
    if (labels.length < 2 || labels.some(function (l) { return !LABEL_RE.test(l); })) return bad("domain_format", "도메인 형식이 올바르지 않습니다.");
    var tld = labels[labels.length - 1];
    if (tld.length < 2 || /^\d+$/.test(tld)) return bad("tld", "도메인 끝부분이 올바르지 않습니다.");
    if (RESERVED_TLDS.indexOf(tld) >= 0 || RESERVED_DOMAINS.indexOf(domain) >= 0) return bad("reserved", "예시·테스트용 도메인은 쓸 수 없습니다.");
    for (var i = 0; i < DISPOSABLE.length; i++) {
      if (domain === DISPOSABLE[i] || domain.slice(-(DISPOSABLE[i].length + 1)) === "." + DISPOSABLE[i]) return bad("disposable", "일회용 이메일은 쓸 수 없습니다.");
    }
    var base = local.split("+")[0];
    var plain = base.replace(/\./g, "");
    if (FAKE_LOCALS.indexOf(base) >= 0 || FAKE_LOCALS.indexOf(plain) >= 0 || /^(.)\1{3,}$/.test(plain)) return bad("fake_local", "임시로 만든 것처럼 보이는 주소입니다. 실제로 쓰는 이메일을 넣어 주세요.");
    // 같은 사람이 변형 주소로 여러 번 받는 것을 막기 위한 비교 키: 지메일류의 점과 +별칭을 접는다
    var key = (domain === "gmail.com" || domain === "googlemail.com") ? plain + "@gmail.com" : base + "@" + domain;
    return { ok: true, email: email, dedupeKey: key, code: "ok", reason: "" };
  }

  return { checkFormat: checkFormat, DISPOSABLE: DISPOSABLE };
});
