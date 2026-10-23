// API 키 발급(이메일 확인) 시험: 서버 연결 전 단계의 로직을 개발 서버와 가짜 시계로 시험한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const EmailCheck = require("../emailcheck.js");
const imp = (f) => import(pathToFileURL(path.join(__dirname, "..", f)).href);

test("가짜로 보이는 이메일을 걸러낸다", () => {
  const bad = ["", "abc", "a@b", "@gmail.com", "user@", "user@@gmail.com", "us er@gmail.com", "user@gmail", "user@gmail.c", "user@-bad.com", "user@gmail..com",
    "test@gmail.com", "asdf@naver.com", "aaaa@gmail.com", "a@gmail.com", "x@gmail.com", "fake@daum.net", "user@example.com", "john@test.com", "me@mailinator.com", "me@sub.yopmail.com",
    "user@company.test", "user@localhost", "user@123.456", ".dot@gmail.com", "dot.@gmail.com", "do..t@gmail.com", "a".repeat(65) + "@gmail.com", "user@" + "a".repeat(64) + ".com"];
  for (const e of bad) assert.equal(EmailCheck.checkFormat(e).ok, false, "통과하면 안 됨: " + e);
  for (const nonStr of [null, undefined, 42, {}, []]) assert.equal(EmailCheck.checkFormat(nonStr).ok, false);
});

test("정상 형식의 주소는 통과하고, 지메일 변형은 같은 사람으로 본다", () => {
  for (const e of ["hong.gildong@gmail.com", "sam01110873@gmail.com", "kim_jae-hyun@company.co.kr", "  Alice+news@Example-Corp.io  ", "yuna.park@sub.domain.org"]) assert.equal(EmailCheck.checkFormat(e).ok, true, e);
  assert.equal(EmailCheck.checkFormat("Hong.Gil.Dong+a@gmail.com").dedupeKey, EmailCheck.checkFormat("hong.gildong@googlemail.com").dedupeKey);
  assert.notEqual(EmailCheck.checkFormat("a.b@company.com").dedupeKey, EmailCheck.checkFormat("ab@company.com").dedupeKey);
});

test("키 발급: 요청 → 메일 링크 → 키 1회 표시 → 인증 → 재사용 불가", async () => {
  const { startDevServer } = await imp("keys/dev-server.mjs");
  const s = await startDevServer({ port: 0 });
  try {
    const post = (p, b, h) => fetch(s.url + p, { method: "POST", headers: { "content-type": "application/json", ...(h || {}) }, body: JSON.stringify(b) });
    let r = await post("/keys/request", { email: "test@gmail.com" });
    assert.equal(r.status, 400);
    assert.equal(s.mailer.outbox.length, 0, "가짜 주소에는 메일을 보내면 안 됨");
    r = await post("/keys/request", { email: "real.person@company.co.kr" });
    assert.equal(r.status, 202);
    assert.equal(s.mailer.outbox.length, 1);
    const link = s.mailer.outbox[0].text.match(/https?:\/\/\S+/)[0];
    // 키는 링크를 누르기 전에는 없다
    assert.equal((await post("/v1/check", { source: "a", output: "b" })).status, 401);
    const page = await fetch(link);
    const text = await page.text();
    assert.equal(page.status, 200);
    const key = text.match(/rs_[A-Za-z0-9_-]{20,}/)[0];
    assert.equal((await fetch(link)).status, 400, "링크는 한 번만");
    // 저장소에는 키 원문이 없다
    const dump = JSON.stringify([...s.service._store._dump()]);
    assert.ok(!dump.includes(key), "키 원문이 저장되면 안 됨");
    const ok = await post("/v1/verify", { requirement: "값 0.9685245400", result: "값 0.96852454 모두 완료" }, { authorization: "Bearer " + key });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).autoCheck.findings.length >= 1);
    assert.equal((await post("/v1/verify", {}, { authorization: "Bearer rs_wrongwrongwrongwrongwrong" })).status, 401);
    // 다시 발급하면 이전 키는 폐기
    await post("/keys/request", { email: "Real.Person@company.co.kr" });
    const link2 = s.mailer.outbox[1].text.match(/https?:\/\/\S+/)[0];
    const key2 = (await (await fetch(link2)).text()).match(/rs_[A-Za-z0-9_-]{20,}/)[0];
    assert.notEqual(key, key2);
    assert.equal((await post("/v1/check", { source: "a1", output: "a1" }, { authorization: "Bearer " + key })).status, 401);
    assert.equal((await post("/v1/check", { source: "a1", output: "a1" }, { authorization: "Bearer " + key2 })).status, 200);
  } finally { s.server.close(); }
});

test("메일 받을 수 없는 도메인, 요청 횟수 제한, 만료, 이상한 본문", async () => {
  const { createService, devMailer, memoryStore } = await imp("keys/service.mjs");
  let t = 1_000_000;
  const mailer = devMailer();
  const svc = createService({ store: memoryStore(), mailer, now: () => t, mailDomainExists: async (d) => d !== "nomx.example-corp.io" });
  assert.equal((await svc.requestKey("someone@nomx.example-corp.io")).status, 400);
  assert.equal(mailer.outbox.length, 0);
  for (let i = 0; i < 3; i++) assert.equal((await svc.requestKey("rate.limit@company.com", "1.1.1." + i)).status, 202);
  assert.equal((await svc.requestKey("rate.limit@company.com", "9.9.9.9")).status, 429);
  const ipSvc = createService({ store: memoryStore(), mailer: devMailer(), now: () => t, mailDomainExists: async () => true });
  let last;
  for (let i = 0; i < 11; i++) last = await ipSvc.requestKey("user" + i + "x@company.com", "2.2.2.2");
  assert.equal(last.status, 429);
  const tok = mailer.outbox[0].text.match(/token=([0-9a-f]{64})/)[1];
  t += 31 * 60 * 1000;
  assert.equal((await svc.verify(tok)).body.code, "expired");
  for (const bad of [undefined, null, "", "zz", "g".repeat(64), 12, {}]) assert.equal((await svc.verify(bad)).status, 400);
  assert.equal(await svc.authenticate(undefined), null);
  assert.equal(await svc.authenticate("Bearer "), null);
  assert.equal(await svc.authenticate("Basic abc"), null);
  assert.equal((await svc.requestKey({ evil: 1 })).status, 400);
});

test("HTTP: 잘못된 JSON, 허용되지 않은 출처, 없는 경로", async () => {
  const { startDevServer } = await imp("keys/dev-server.mjs");
  const s = await startDevServer({ port: 0 });
  try {
    const bad = await fetch(s.url + "/keys/request", { method: "POST", body: "{깨짐" });
    assert.equal(bad.status, 400);
    const evil = await fetch(s.url + "/health", { headers: { origin: "https://evil.example.org" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const good = await fetch(s.url + "/health", { headers: { origin: "https://alska14.github.io" } });
    assert.equal(good.headers.get("access-control-allow-origin"), "https://alska14.github.io");
    assert.equal((await fetch(s.url + "/없음".replace(/[^\x00-\x7F]/g, "x"))).status, 404);
    assert.equal((await fetch(s.url + "/constructor")).status, 404);
  } finally { s.server.close(); }
});
