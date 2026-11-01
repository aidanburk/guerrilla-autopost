// Tomy's Monday email. Numbers come straight from the sources and are printed by code;
// the AI only writes the short "what it means" note and this week's 1-2 to-dos.
import { upcomingEvents, prettyDate } from "./knowledge.js";
import { sendEmail, esc } from "./email.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function weeklyReport(env, { send = false, to } = {}) {
  const end = new Date(Date.now() - 864e5);           // yesterday
  const start = new Date(Date.now() - 7 * 864e5);
  const iso = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const range = { start: iso(start), end: iso(end) };

  const [ga, ig, leads, questions] = await Promise.all([
    gaStats(env).catch((e) => ({ error: String(e.message || e) })),
    igStats(env).catch((e) => ({ error: String(e.message || e) })),
    kvSince(env, "lead:", range.start).then((rows) => rows.map((r) => JSON.parse(r))),
    kvSince(env, "q:", range.start),
  ]);
  const events = upcomingEvents(iso(new Date())).filter(([d]) => d <= iso(new Date(Date.now() + 21 * 864e5)));
  const stats = { range, ga, ig, leads, questions, events };
  const ai = await aiNote(env, stats).catch((e) => (console.error("AI note failed", e), null));
  const html = render(stats, ai);
  const subject = subjectLine(stats);
  let result = null;
  if (send) result = await sendEmail(env, { to: to || env.REPORT_TO, subject, html });
  return { html, subject, stats, result };
}

// ---------- data ----------

async function kvSince(env, prefix, startDay) {
  const out = [];
  let cursor;
  do {
    const page = await env.MELLO_KV.list({ prefix, cursor });
    for (const k of page.keys) {
      const day = k.name.slice(prefix.length, prefix.length + 10);
      if (day >= startDay) out.push(await env.MELLO_KV.get(k.name));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.filter(Boolean);
}

async function gaStats(env) {
  if (!env.GA_PROPERTY_ID || !env.GA_SA_KEY) return { notConnected: true };
  const token = await googleToken(JSON.parse(env.GA_SA_KEY));
  const run = (body) => fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => { if (!r.ok) throw new Error(`GA ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); });

  const thisWeek = { startDate: "7daysAgo", endDate: "yesterday" };
  const lastWeek = { startDate: "14daysAgo", endDate: "8daysAgo" };
  const [totals, sources, pages, events] = await Promise.all([
    run({ dateRanges: [thisWeek, lastWeek], metrics: [{ name: "sessions" }, { name: "screenPageViews" }] }),
    run({ dateRanges: [thisWeek], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], limit: 6 }),
    run({ dateRanges: [thisWeek], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], limit: 5 }),
    run({ dateRanges: [thisWeek, lastWeek], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 50 }),
  ]);

  const byRange = (rep, i) => (rep.rows || []).find((r) => (r.dimensionValues || []).some((d) => d.value === `date_range_${i}`));
  const num = (row, j) => Number(row?.metricValues?.[j]?.value || 0);
  const t0 = byRange(totals, 0) || totals.rows?.[0], t1 = byRange(totals, 1) || totals.rows?.[1];

  // Shop clicks: the event set up with the site's shop-click tracking (SHOP_EVENT), or any event that looks like it.
  const want = (env.SHOP_EVENT || "").trim();
  const isShop = (name) => (want ? name === want : /shop|square|outbound|click_to_shop/i.test(name));
  const shop = [0, 0];
  for (const r of events.rows || []) {
    const name = r.dimensionValues[0].value;
    const idx = (r.dimensionValues[1]?.value || "date_range_0").endsWith("1") ? 1 : 0;
    if (isShop(name)) shop[idx] += Number(r.metricValues[0].value);
  }

  return {
    visits: num(t0, 0), visitsLastWeek: num(t1, 0),
    pageViews: num(t0, 1),
    shopClicks: shop[0], shopClicksLastWeek: shop[1],
    sources: (sources.rows || []).map((r) => [r.dimensionValues[0].value, Number(r.metricValues[0].value)]),
    topPages: (pages.rows || []).map((r) => [r.dimensionValues[0].value, Number(r.metricValues[0].value)]),
  };
}

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => btoa(typeof o === "string" ? o : JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64(String.fromCharCode(...sig))}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!r.ok) throw new Error(`Google sign-in ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

async function igStats(env) {
  if (!env.IG_TOKEN || !env.IG_USER_ID) return { notConnected: true };
  const api = env.IG_TOKEN.startsWith("EAA") ? "https://graph.facebook.com/v21.0" : "https://graph.instagram.com/v21.0";
  const get = (path, fields) => fetch(`${api}/${path}?fields=${fields}&access_token=${encodeURIComponent(env.IG_TOKEN)}`)
    .then(async (r) => { if (!r.ok) throw new Error(`Instagram ${r.status}`); return r.json(); });
  const [me, media] = await Promise.all([get(env.IG_USER_ID, "followers_count,media_count"), get(`${env.IG_USER_ID}/media`, "timestamp")]);
  const since = Date.now() - 7 * 864e5;
  return {
    followers: me.followers_count ?? null,
    postsThisWeek: (media.data || []).filter((m) => Date.parse(m.timestamp) >= since).length,
  };
}

// ---------- AI note ----------

async function aiNote(env, s) {
  if (!env.AI) return null;
  const facts = {
    week: `${s.range.start} to ${s.range.end}`,
    website: s.ga.notConnected || s.ga.error ? "not available this week" : {
      visits: s.ga.visits, visitsLastWeek: s.ga.visitsLastWeek, shopClicks: s.ga.shopClicks,
      shopClicksLastWeek: s.ga.shopClicksLastWeek, sources: s.ga.sources, topPages: s.ga.topPages,
    },
    instagram: s.ig.notConnected || s.ig.error ? "not available this week" : s.ig,
    newLeads: s.leads.map((l) => ({ type: l.type, name: l.name, date: l.date || "", guests: l.guests || "", business: l.business || "" })),
    customerQuestions: s.questions.slice(0, 15),
    upcomingMarkets: s.events.map(([d, n, , t]) => `${prettyDate(d)} ${n} (${t})`),
  };
  const out = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: `You write the weekly note for Tomy, who owns Mello Brands (small-batch tea, brisket jerky, kettle corn) with his wife Claire in Jefferson Hills, PA. He is busy and not technical.
Write like a friendly, honest advisor: plain words, short sentences, no jargon (no "sessions", "CTR", "engagement"). If the week was slow, say so kindly and give something concrete. Never invent numbers or facts that are not in the data. Never say a store or vendor was contacted. Only mention items in the data.
Reply with JSON only: {"note": "2-3 sentences on what happened and what it means", "todo": ["one specific action for this week", "optional second action"]}.
Good to-dos: reply to a new lead by name, bring the QR sign to an upcoming market, call one wholesale prospect from the list, ask happy customers for a Google review, post a photo from the weekend.` },
      { role: "user", content: JSON.stringify(facts) },
    ],
    max_tokens: 300,
    temperature: 0.3,
  });
  const text = (out && (out.response ?? out.result?.response)) || "";
  const parsed = typeof text === "object" ? text : JSON.parse(String(text).match(/\{[\s\S]*\}/)?.[0] || "null");
  if (!parsed || typeof parsed.note !== "string") return null;
  return { note: parsed.note.slice(0, 600), todo: (parsed.todo || []).filter((t) => typeof t === "string").slice(0, 2).map((t) => t.slice(0, 200)) };
}

// ---------- email ----------

function subjectLine(s) {
  const parts = [];
  if (!s.ga.notConnected && !s.ga.error) parts.push(`${s.ga.visits} website visits`);
  const cat = s.leads.filter((l) => l.type === "catering").length, ws = s.leads.length - cat;
  if (cat) parts.push(`${cat} catering request${cat > 1 ? "s" : ""}`);
  if (ws) parts.push(`${ws} wholesale inquir${ws > 1 ? "ies" : "y"}`);
  return `Mello this week${parts.length ? ": " + parts.join(", ") : ""}`;
}

const change = (now, before) => {
  if (!before) return "";
  const d = now - before;
  return d === 0 ? " (same as last week)" : ` (${d > 0 ? "up" : "down"} from ${before} last week)`;
};
const SOURCE_NAMES = { "Organic Search": "Google search", Direct: "typed in or shared link", "Organic Social": "social media", Referral: "other websites", Unassigned: "other" };

function render(s, ai) {
  const C = { green: "#1f3328", sage: "#3a5a43", terra: "#bb6438", cream: "#fbf6ec" };
  const li = (t) => `<li style="margin:0 0 6px">${t}</li>`;
  const section = (title, body) => `<h3 style="color:${C.terra};font-size:16px;margin:22px 0 8px">${title}</h3>${body}`;

  let web;
  if (s.ga.notConnected) web = "<p>Website numbers aren't connected yet.</p>";
  else if (s.ga.error) web = `<p>Couldn't read website numbers this week.</p>`;
  else {
    const src = s.ga.sources.map(([n, v]) => `${esc(SOURCE_NAMES[n] || n)} ${v}`).join(", ");
    web = `<ul style="padding-left:18px;margin:0">
      ${li(`<b>${s.ga.visits}</b> visits to melloteas.com${change(s.ga.visits, s.ga.visitsLastWeek)}`)}
      ${li(`<b>${s.ga.shopClicks}</b> clicks into your shop${change(s.ga.shopClicks, s.ga.shopClicksLastWeek)}`)}
      ${src ? li(`Where they came from: ${src}`) : ""}</ul>`;
  }
  let insta = "";
  if (!s.ig.notConnected && !s.ig.error) insta = `<ul style="padding-left:18px;margin:6px 0 0">${li(`<b>${s.ig.postsThisWeek}</b> Instagram posts went out${s.ig.followers != null ? `, <b>${s.ig.followers}</b> followers` : ""}`)}</ul>`;

  const leads = s.leads.length
    ? `<ul style="padding-left:18px;margin:0">${s.leads.map((l) => li(l.type === "catering"
        ? `<b>Catering:</b> ${esc(l.name)}, ${esc(l.contact)}${l.date ? `, ${esc(l.date)}` : ""}${l.guests ? `, ~${esc(l.guests)} guests` : ""}${l.place ? `, ${esc(l.place)}` : ""}`
        : `<b>Wholesale:</b> ${esc(l.name)}${l.business ? ` (${esc(l.business)})` : ""}, ${esc(l.contact)}`)).join("")}</ul>`
    : "<p style=\"margin:0\">No new requests this week.</p>";

  const qs = s.questions.length
    ? `<ul style="padding-left:18px;margin:0">${s.questions.slice(0, 5).map((q) => li(`"${esc(q)}"`)).join("")}</ul>`
    : "<p style=\"margin:0\">Nobody chatted with Ask Mello this week.</p>";

  const ev = s.events.length ? section("Coming up", `<ul style="padding-left:18px;margin:0">${s.events.map(([d, n, , t]) => li(`${prettyDate(d)}: ${esc(n)}, ${esc(t)}`)).join("")}</ul>`) : "";

  const todo = ai?.todo?.length
    ? `<ol style="padding-left:20px;margin:0">${ai.todo.map((t) => li(esc(t))).join("")}</ol>`
    : `<ol style="padding-left:20px;margin:0">${li(s.leads.length ? "Reply to this week's requests below." : "Ask a happy customer at your next market to leave a Google review.")}</ol>`;

  return `<!doctype html><html><body style="margin:0;background:${C.cream}">
  <div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${C.green}">
    <h2 style="font-family:Georgia,serif;margin:0 0 4px">Mello this week</h2>
    <p style="margin:0 0 16px;color:${C.sage}">${prettyDate(s.range.start)} to ${prettyDate(s.range.end)}</p>
    <p style="margin:0 0 4px">Hi Tomy,</p>
    ${ai?.note ? `<p style="margin:8px 0 0">${esc(ai.note)}</p>` : ""}
    ${section("This week, try this", todo)}
    ${section("New requests from the website", leads)}
    ${section("The numbers", web + insta)}
    ${section("What people asked Ask Mello", qs)}
    ${ev}
    <p style="margin:28px 0 0;color:${C.sage};font-size:13px">Mello AI · sent every Monday morning</p>
  </div></body></html>`;
}
