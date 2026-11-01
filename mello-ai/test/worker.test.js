import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { parseReply } from "../src/worker.js";
import { weeklyReport } from "../src/report.js";
import { widget } from "../src/widget.js";
import { systemPrompt } from "../src/knowledge.js";

function kv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
function env(over = {}) {
  return {
    MELLO_KV: kv(),
    AI: { calls: [], async run(model, input) { this.calls.push(input); return { response: this.next ?? "Try Bombay Chai! https://mello-teas.square.site/product/bombay-chai-tea/5" }; } },
    ALLOWED_ORIGINS: "https://www.melloteas.com,*.framer.app",
    LEAD_TO: "test@example.com", REPORT_TO: "tomy@example.com",
    RESEND_API_KEY: "re_test", ADMIN_KEY: "secret",
    ...over,
  };
}
const ctx = () => { const p = []; return { p, waitUntil: (x) => p.push(x) }; };
const post = (path, body, origin = "https://www.melloteas.com") =>
  new Request("https://mello-ai.example.workers.dev" + path, { method: "POST", headers: { "content-type": "application/json", origin, "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(body) });

const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  throw new Error("unexpected fetch " + url);
};

test("chat answers with the knowledge prompt and CORS for the site", async () => {
  const e = env();
  const r = await worker.fetch(post("/chat", { messages: [{ role: "user", content: "something spicy?" }] }), e, ctx());
  assert.equal(r.headers.get("access-control-allow-origin"), "https://www.melloteas.com");
  const j = await r.json();
  assert.match(j.reply, /Bombay Chai/);
  assert.equal(j.form, null);
  assert.match(e.AI.calls[0].messages[0].content, /Ask Mello/);
  assert.equal(e.AI.calls[0].messages.at(-1).content, "something spicy?");
  assert.ok([...e.MELLO_KV.m.keys()].some((k) => k.startsWith("q:")), "question logged");
});

test("framer preview origin allowed, random origin not", async () => {
  const ok = await worker.fetch(post("/chat", { messages: [{ role: "user", content: "hi" }] }, "https://independent-commit-390099.framer.app"), env(), ctx());
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://independent-commit-390099.framer.app");
  const no = await worker.fetch(post("/chat", { messages: [{ role: "user", content: "hi" }] }, "https://evil.com"), env(), ctx());
  assert.equal(no.headers.get("access-control-allow-origin"), null);
});

test("form tag is stripped and returned", () => {
  assert.deepEqual(parseReply("We'd love to pop for you! [[FORM:catering]]"), { reply: "We'd love to pop for you!", form: "catering" });
  assert.equal(parseReply("Sure [[ form : Wholesale ]]").form, "wholesale");
});

test("daily AI cap returns the phone number instead of calling AI", async () => {
  const e = env({ AI_DAILY_CAP: "1" });
  await worker.fetch(post("/chat", { messages: [{ role: "user", content: "a" }] }), e, ctx());
  const j = await (await worker.fetch(post("/chat", { messages: [{ role: "user", content: "b" }] }), e, ctx())).json();
  assert.match(j.reply, /412-901-4372/);
  assert.equal(e.AI.calls.length, 1);
});

test("AI failure falls back politely", async () => {
  const e = env();
  e.AI.run = async () => { throw new Error("boom"); };
  const j = await (await worker.fetch(post("/chat", { messages: [{ role: "user", content: "x" }] }), e, ctx())).json();
  assert.match(j.reply, /412-901-4372/);
});

test("catering lead is stored and emailed with reply-to", async () => {
  sent.length = 0;
  const e = env(), c = ctx();
  const j = await (await worker.fetch(post("/lead", { type: "catering", name: "Jen <b>R</b>", contact: "jen@example.com", date: "Dec 14", guests: "60", place: "Clairton" }), e, c)).json();
  await Promise.all(c.p);
  assert.equal(j.ok, true);
  assert.ok([...e.MELLO_KV.m.keys()].some((k) => k.startsWith("lead:")));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reply_to, "jen@example.com");
  assert.deepEqual(sent[0].to, ["test@example.com"]);
  assert.match(sent[0].html, /Jen &lt;b&gt;R&lt;\/b&gt;/, "escaped");
});

test("lead needs name and contact; honeypot is silently dropped", async () => {
  const e = env();
  const bad = await (await worker.fetch(post("/lead", { type: "catering", name: "" }), e, ctx())).json();
  assert.equal(bad.ok, false);
  const bot = await (await worker.fetch(post("/lead", { type: "catering", name: "x", contact: "y", website: "spam" }), e, ctx())).json();
  assert.equal(bot.ok, true);
  assert.ok(![...e.MELLO_KV.m.keys()].some((k) => k.startsWith("lead:")));
});

test("weekly report prints leads and questions, never invents website numbers", async () => {
  sent.length = 0;
  const e = env();
  e.AI.next = JSON.stringify({ note: "Quiet week online, but one catering request came in.", todo: ["Call Jen back about Dec 14."] });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await e.MELLO_KV.put(`lead:${day}:a1`, JSON.stringify({ type: "catering", name: "Jen", contact: "412-555-0100", date: "Dec 14", guests: "60" }));
  await e.MELLO_KV.put(`q:${day}:b2`, "do you ship?");
  await e.MELLO_KV.put(`q:2020-01-01:old`, "ancient question");
  const r = await weeklyReport(e, { send: true });
  assert.match(r.subject, /1 catering request/);
  assert.match(r.html, /Call Jen back/);
  assert.match(r.html, /412-555-0100/);
  assert.match(r.html, /do you ship\?/);
  assert.doesNotMatch(r.html, /ancient question/);
  assert.match(r.html, /Website numbers aren't connected yet/);
  assert.deepEqual(sent[0].to, ["tomy@example.com"]);
});

test("report survives bad AI output", async () => {
  const e = env();
  e.AI.next = "not json at all";
  const r = await weeklyReport(e, {});
  assert.match(r.html, /Mello this week/);
  assert.match(r.html, /Google review/);
});

test("report preview needs the admin key", async () => {
  const no = await worker.fetch(new Request("https://x.dev/report?key=wrong"), env(), ctx());
  assert.equal(no.status, 404);
  const yes = await worker.fetch(new Request("https://x.dev/report?key=secret"), env(), ctx());
  assert.match(await yes.text(), /Mello this week/);
});

test("widget script is valid JS with the API baked in", () => {
  const src = widget("https://mello-ai.example.workers.dev");
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /mello-ai\.example\.workers\.dev/);
});

test("system prompt drops past events and keeps guardrails", () => {
  const p = systemPrompt("2026-12-01");
  assert.doesNotMatch(p, /Liberty Borough VFD/);
  assert.match(p, /Holiday in the Hills/);
  assert.match(p, /No health or medical claims/);
});

test("Google Analytics: signs in with the service account and reads this week vs last", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = { client_email: "mello@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const orig = globalThis.fetch;
  let jwtOk = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      const jwt = decodeURIComponent(init.body.split("assertion=")[1]);
      const [h, p, s] = jwt.split(".");
      jwtOk = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))
        && JSON.parse(Buffer.from(p, "base64url")).iss === sa.client_email;
      return new Response(JSON.stringify({ access_token: "tok" }));
    }
    if (String(url).includes("runReport")) {
      const b = JSON.parse(init.body), dim = b.dimensions?.[0]?.name;
      const row = (dims, vals) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: vals.map((value) => ({ value: String(value) })) });
      const rows = !dim ? [row(["date_range_0"], [52, 80]), row(["date_range_1"], [38, 60])]
        : dim === "eventName" ? [row(["shop_click", "date_range_0"], [9]), row(["shop_click", "date_range_1"], [4]), row(["page_view", "date_range_0"], [80])]
        : dim === "pagePath" ? [row(["/"], [40]), row(["/teas"], [20])]
        : [row(["Organic Search"], [30]), row(["Direct"], [22])];
      return new Response(JSON.stringify({ rows }));
    }
    return orig(url, init);
  };
  try {
    const e = env({ GA_PROPERTY_ID: "123", GA_SA_KEY: JSON.stringify(sa) });
    e.AI.next = "{}";
    const r = await weeklyReport(e, {});
    assert.ok(jwtOk, "JWT verifies");
    assert.equal(r.stats.ga.visits, 52);
    assert.equal(r.stats.ga.visitsLastWeek, 38);
    assert.equal(r.stats.ga.shopClicks, 9);
    assert.match(r.html, /<b>52<\/b> visits to melloteas.com \(up from 38 last week\)/);
    assert.match(r.html, /Google search 30/);
  } finally { globalThis.fetch = orig; }
});
