// API 키 발급 서비스(서버 연결 전 상태): 이메일 확인 → 키 1회 표시. 저장소와 메일 발송은 바꿔 끼울 수 있다.
// 서버에 올릴 때 바꿀 것: store(지금은 메모리) → KV/DB, mailer(지금은 개발용 우편함) → 실제 메일 서비스. keys/README.md 참고.
import { createRequire } from "node:module";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveMx, resolve4, resolve6 } from "node:dns/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const EmailCheck = require(join(dirname(fileURLToPath(import.meta.url)), "..", "emailcheck.js"));

export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

/* 메모리 저장소(개발·시험용). 같은 모양(get/set/del)의 KV 로 바꾸면 서버리스에서도 쓴다. */
export function memoryStore() {
  const m = new Map();
  return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async del(k) { m.delete(k); }, _dump: () => m };
}

/* 도메인이 메일을 받을 수 있는지(MX 또는 A/AAAA). 시험에서는 가짜 resolver 를 넣는다. */
export async function defaultMailDomainExists(domain) {
  try { const mx = await resolveMx(domain); if (mx && mx.length) return true; } catch (e) { if (e && e.code !== "ENODATA" && e.code !== "ENOTFOUND") return null; }
  try { const a = await resolve4(domain); if (a && a.length) return true; } catch (e) { /* 다음으로 */ }
  try { const a6 = await resolve6(domain); if (a6 && a6.length) return true; } catch (e) { /* 없음 */ }
  return false;
}

export function createService({ store = memoryStore(), mailer, baseUrl = "http://127.0.0.1:8788", now = () => Date.now(), mailDomainExists = defaultMailDomainExists,
  tokenTtlMs = 30 * 60 * 1000, perEmailPerHour = 3, perIpPerHour = 10 } = {}) {
  if (!mailer || typeof mailer.send !== "function") throw new Error("mailer.send 가 필요합니다");

  async function hit(bucket, limit) {
    const t = now();
    const rec = (await store.get("rl:" + bucket)) || { start: t, n: 0 };
    if (t - rec.start > 3600_000) { rec.start = t; rec.n = 0; }
    rec.n += 1;
    await store.set("rl:" + bucket, rec);
    return rec.n <= limit;
  }

  /* 1단계: 이메일 확인 메일 보내기. 응답은 주소가 이미 있는지 알려 주지 않는다. */
  async function requestKey(email, ip = "unknown") {
    const f = EmailCheck.checkFormat(email);
    if (!f.ok) return { status: 400, body: { ok: false, code: f.code, error: f.reason } };
    if (!(await hit("ip:" + ip, perIpPerHour)) || !(await hit("em:" + sha256(f.dedupeKey), perEmailPerHour))) {
      return { status: 429, body: { ok: false, code: "rate_limited", error: "요청이 너무 많습니다. 잠시 뒤에 다시 시도하세요." } };
    }
    const domain = f.email.split("@")[1];
    const exists = await mailDomainExists(domain);
    if (exists === false) return { status: 400, body: { ok: false, code: "no_mail_domain", error: "메일을 받을 수 없는 도메인입니다." } };
    const token = randomBytes(32).toString("hex");
    await store.set("tok:" + sha256(token), { email: f.email, dedupeKey: f.dedupeKey, exp: now() + tokenTtlMs });
    const base = typeof baseUrl === "function" ? baseUrl() : baseUrl;
    const link = String(base).replace(/\/$/, "") + "/keys/verify?token=" + token;
    await mailer.send({ to: f.email, subject: "AI 완료 보고 점검기 API 키 확인", text: "아래 링크를 누르면 API 키가 한 번 표시됩니다(" + Math.round(tokenTtlMs / 60000) + "분 안에).\n" + link + "\n\n요청하지 않았다면 이 메일을 무시하세요." });
    return { status: 202, body: { ok: true, message: "확인 메일을 보냈습니다. 메일의 링크를 눌러야 키가 발급됩니다." } };
  }

  /* 2단계: 링크 확인 → 키 발급(원문 키는 이 응답에서만 보여 주고 저장하지 않는다). */
  async function verify(token) {
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return { status: 400, body: { ok: false, code: "bad_token", error: "링크가 올바르지 않습니다." } };
    const k = "tok:" + sha256(token);
    const rec = await store.get(k);
    if (!rec) return { status: 400, body: { ok: false, code: "unknown_token", error: "이미 사용했거나 없는 링크입니다." } };
    await store.del(k); // 한 번만 쓸 수 있다
    if (now() > rec.exp) return { status: 400, body: { ok: false, code: "expired", error: "링크가 만료됐습니다. 다시 요청하세요." } };
    const old = await store.get("em:" + rec.dedupeKey);
    if (old && old.keyHash) await store.del("key:" + old.keyHash); // 같은 사람의 이전 키는 폐기
    const key = "rs_" + randomBytes(32).toString("base64url");
    const keyHash = sha256(key);
    await store.set("key:" + keyHash, { dedupeKey: rec.dedupeKey, createdAt: now() });
    await store.set("em:" + rec.dedupeKey, { keyHash, email: rec.email });
    return { status: 200, body: { ok: true, apiKey: key, notice: "이 키는 지금 한 번만 보입니다. 안전한 곳에 저장하세요." } };
  }

  /* 키 확인(요청마다). 저장된 것은 해시뿐이다. */
  async function authenticate(authorization) {
    const m = /^Bearer\s+(rs_[A-Za-z0-9_-]{20,80})$/.exec(String(authorization || ""));
    if (!m) return null;
    const rec = await store.get("key:" + sha256(m[1]));
    return rec || null;
  }

  return { requestKey, verify, authenticate, _store: store };
}

/* 개발용 메일: 실제로 보내지 않고 우편함에 쌓는다(시험·로컬 확인용). */
export function devMailer() {
  const outbox = [];
  return { outbox, async send(msg) { outbox.push({ ...msg, at: Date.now() }); } };
}

/* 실제 메일 발송(Resend REST). 서버 연결 때 쓰는 어댑터이며, 실제 서비스와의 연결 시험은 하지 못했다. */
export function resendMailer({ apiKey, from }) {
  if (!apiKey || !from) throw new Error("RESEND_API_KEY 와 MAIL_FROM 이 필요합니다");
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text }) });
      if (!res.ok) throw new Error("메일 발송 실패: " + res.status);
    }
  };
}

export { timingSafeEqual };
