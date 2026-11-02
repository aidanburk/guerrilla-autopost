// Mello Helper: Tomy's private phone page at /helper?k=<HELPER_KEY>.
// Requests (with AI-written replies), this week's numbers, and events he can add for the website chat.
import { allEvents, prettyDate } from "./knowledge.js";
import { gatherStats } from "./report.js";
import { esc } from "./email.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const STATUSES = ["new", "replied", "booked", "no"];

export async function helperRoute(req, url, env) {
  const key = url.searchParams.get("k") || req.headers.get("x-helper-key") || "";
  if (!env.HELPER_KEY || key !== env.HELPER_KEY) return new Response("Not found", { status: 404 });
  if (url.pathname === "/helper") return new Response(page(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

  const parts = url.pathname.split("/").filter(Boolean); // ["api", thing, id?, action?]
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (parts[1] === "leads" && req.method === "GET") return json(await listLeads(env));
  if (parts[1] === "leads" && parts[2] && req.method === "POST") {
    const id = decodeURIComponent(parts[2]);
    if (!id.startsWith("lead:")) return json({ error: "bad id" }, 400);
    const raw = await env.MELLO_KV.get(id);
    if (!raw) return json({ error: "not found" }, 404);
    const rec = JSON.parse(raw);
    if (parts[3] === "draft") {
      rec.draft = await draftReply(env, rec);
    } else if (STATUSES.includes(body.status)) {
      rec.status = body.status;
    }
    await env.MELLO_KV.put(id, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
    return json({ id, ...rec });
  }

  if (parts[1] === "week") {
    const s = await gatherStats(env);
    return json({ range: s.range, ga: s.ga, ig: s.ig, questions: s.questions.slice(0, 8), leads: s.leads.length });
  }

  if (parts[1] === "events" && req.method === "GET") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const added = JSON.parse((await env.MELLO_KV.get("events")) || "[]");
    const all = (await allEvents(env)).filter(([d]) => d >= today)
      .map(([date, name, place, town]) => ({ date, name, place, town, mine: added.some((a) => a.date === date && a.name === name) }));
    return json(all);
  }
  if (parts[1] === "events" && req.method === "POST") {
    const date = String(body.date || ""), name = String(body.name || "").trim().slice(0, 100);
    const added = JSON.parse((await env.MELLO_KV.get("events")) || "[]");
    if (body.remove) {
      const left = added.filter((a) => !(a.date === date && a.name === name));
      await env.MELLO_KV.put("events", JSON.stringify(left));
      return json({ ok: true });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return json({ error: "Add a date and a name." }, 400);
    added.push({ date, name, place: String(body.place || "").trim().slice(0, 100), town: String(body.town || "").trim().slice(0, 60) });
    await env.MELLO_KV.put("events", JSON.stringify(added.slice(-50)));
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

async function listLeads(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.MELLO_KV.list({ prefix: "lead:", cursor });
    for (const k of page.keys) {
      const raw = await env.MELLO_KV.get(k.name);
      if (raw) out.push({ id: k.name, status: "new", ...JSON.parse(raw) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

async function draftReply(env, l) {
  const facts = l.type === "catering"
    ? `Kettle corn catering request. Name: ${l.name}. Date: ${l.date || "not given"}. Guests: ${l.guests || "not given"}. Place: ${l.place || "not given"}. Event type: ${l.kind || "not given"}. Notes: ${l.notes || "none"}.`
    : `Wholesale inquiry. Name: ${l.name}. Business: ${l.business || "not given"}. Interested in: ${l.notes || "not given"}.`;
  const out = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: `Write a short, warm reply from Tomy at Mello Brands (family-run tea, brisket jerky and kettle corn business in Jefferson Hills, PA) to the person below. 3 to 5 sentences, plain text, first names, no subject line, sign off "Tomy, Mello Brands". Thank them, repeat back the details they gave, and ask for anything missing that Tomy needs (for catering: date, location, guest count, start time; for wholesale: what products and roughly how much). Never state a price, put [PRICE] where Tomy should add one if pricing comes up. Never promise availability; say Tomy will confirm.` },
      { role: "user", content: facts },
    ],
    max_tokens: 250,
    temperature: 0.5,
  });
  return String((out && (out.response ?? out.result?.response)) || "").trim().slice(0, 1200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Mello">
<meta name="theme-color" content="#1f3328"><title>Mello Helper</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f3328"/><text x="32" y="44" font-size="34" text-anchor="middle" fill="#d99a4e" font-family="Georgia">M</text></svg>')}">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Nunito+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--green:#1f3328;--sage:#3a5a43;--terra:#bb6438;--gold:#d99a4e;--cream:#fbf6ec;--paper:#fffdf8;--line:#e8dfcc}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--green);font:16px/1.45 "Nunito Sans",system-ui,sans-serif;padding-bottom:84px}
header{background:var(--green);color:var(--cream);padding:calc(14px + env(safe-area-inset-top)) 16px 14px}
header h1{font:600 22px Fraunces,Georgia,serif;margin:0}header p{margin:2px 0 0;opacity:.8;font-size:14px}
main{padding:16px;max-width:640px;margin:0 auto}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 12px}
.card h3{margin:0 0 4px;font-size:17px}.muted{color:#6b7a6f;font-size:14px}
.tag{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:2px 9px;background:var(--cream);color:var(--sage);text-transform:uppercase;letter-spacing:.03em}
.tag.new{background:var(--terra);color:#fff}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button,.btn{font:700 15px "Nunito Sans",sans-serif;border:1px solid var(--terra);color:var(--terra);background:#fff;border-radius:10px;padding:9px 13px;cursor:pointer;text-decoration:none}
button.main,.btn.main{background:var(--terra);color:#fff}
button.on{background:var(--sage);border-color:var(--sage);color:#fff}
textarea,input{width:100%;font:15px "Nunito Sans",sans-serif;border:1px solid #d9cfba;border-radius:10px;padding:10px;background:var(--paper);color:var(--green)}
textarea{min-height:140px;margin-top:10px}
.big{font:600 34px Fraunces,Georgia,serif;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
nav{position:fixed;left:0;right:0;bottom:0;background:var(--paper);border-top:1px solid var(--line);display:flex;padding-bottom:env(safe-area-inset-bottom)}
nav button{flex:1;border:0;border-radius:0;background:none;color:#6b7a6f;padding:12px 4px 14px;font-size:14px}
nav button.here{color:var(--terra)}
.empty{text-align:center;color:#6b7a6f;padding:30px 10px}
label{font-size:14px;font-weight:700;display:block;margin:10px 0 4px}
</style></head><body>
<header><h1>Mello Helper</h1><p id="sub">Hi Tomy 👋</p></header>
<main id="view"><p class="empty">Loading...</p></main>
<nav><button data-tab="requests" class="here">Requests</button><button data-tab="week">My week</button><button data-tab="events">Events</button></nav>
<script>
const K = new URLSearchParams(location.search).get("k") || "";
const api = (p, o = {}) => fetch(p + (p.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(K), { ...o, headers: { "content-type": "application/json" } }).then(r => r.json());
const view = document.getElementById("view");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
let tab = "requests";
document.querySelectorAll("nav button").forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll("nav button").forEach(x => x.classList.toggle("here", x === b)); show(); });

async function show() {
  view.innerHTML = '<p class="empty">Loading...</p>';
  try { await ({ requests, week, events })[tab](); } catch (e) { view.innerHTML = '<p class="empty">Couldn\\'t load. Check your connection and try again.</p>'; }
}

async function requests() {
  const leads = await api("/api/leads");
  if (!leads.length) { view.innerHTML = '<p class="empty">No requests yet. When someone asks Ask Mello to book kettle corn or carry your products, it shows up here and in your email.</p>'; return; }
  view.innerHTML = "";
  for (const l of leads) {
    const c = document.createElement("div"); c.className = "card";
    const phone = (l.contact.match(/[\\d().\\- ]{10,}/) || [""])[0].replace(/\\D/g, "");
    const email = (l.contact.match(/\\S+@\\S+\\.\\S+/) || [""])[0];
    const details = l.type === "catering"
      ? [l.date && "📅 " + esc(l.date), l.guests && "👥 " + esc(l.guests) + " guests", l.place && "📍 " + esc(l.place), l.kind && esc(l.kind)].filter(Boolean).join(" · ")
      : [l.business && "🏪 " + esc(l.business)].filter(Boolean).join(" · ");
    c.innerHTML = '<span class="tag ' + (l.status === "new" ? "new" : "") + '">' + esc(l.status) + '</span> <span class="muted">' + (l.type === "catering" ? "Kettle corn / catering" : "Wholesale") + " · " + new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + '</span>' +
      '<h3>' + esc(l.name) + '</h3><div class="muted">' + esc(l.contact) + '</div>' + (details ? '<div style="margin-top:6px">' + details + '</div>' : "") +
      (l.notes ? '<div style="margin-top:6px">"' + esc(l.notes) + '"</div>' : "") +
      '<div class="row">' + (phone ? '<a class="btn" href="tel:' + phone + '">Call</a>' : "") + '<button class="main" data-a="draft">' + (l.draft ? "Show reply" : "Write my reply") + '</button></div>' +
      '<div class="reply"></div>' +
      '<div class="row">' + ["replied", "booked", "no"].map(s => '<button data-s="' + s + '" class="' + (l.status === s ? "on" : "") + '">' + ({ replied: "Replied", booked: "Booked 🎉", no: "Not happening" })[s] + '</button>').join("") + '</div>';
    c.querySelectorAll("[data-s]").forEach(b => b.onclick = async () => { await api("/api/leads/" + encodeURIComponent(l.id), { method: "POST", body: JSON.stringify({ status: b.dataset.s }) }); show(); });
    c.querySelector("[data-a=draft]").onclick = async (e) => {
      const box = c.querySelector(".reply"); e.target.disabled = true; e.target.textContent = "Writing...";
      const r = l.draft ? l : await api("/api/leads/" + encodeURIComponent(l.id) + "/draft", { method: "POST", body: "{}" });
      l.draft = r.draft; e.target.remove();
      box.innerHTML = '<textarea>' + esc(r.draft || "") + '</textarea><div class="row">' +
        (phone ? '<a class="btn main" data-send="sms">Text it</a>' : "") + (email ? '<a class="btn main" data-send="mail">Email it</a>' : "") + '<button data-copy>Copy</button></div>' +
        '<div class="muted" style="margin-top:6px">Edit anything before sending. Fill in [PRICE] if it\\'s there.</div>';
      const ta = box.querySelector("textarea");
      box.querySelectorAll("[data-send]").forEach(a => a.onclick = () => { a.href = a.dataset.send === "sms" ? "sms:" + phone + "?&body=" + encodeURIComponent(ta.value) : "mailto:" + email + "?subject=" + encodeURIComponent("Mello Brands") + "&body=" + encodeURIComponent(ta.value); });
      box.querySelector("[data-copy]").onclick = (ev) => { navigator.clipboard.writeText(ta.value).then(() => ev.target.textContent = "Copied ✓"); };
    };
    view.appendChild(c);
  }
}

async function week() {
  const w = await api("/api/week");
  const ga = w.ga || {}, ig = w.ig || {};
  const change = (a, b) => b ? (a > b ? "▲ up from " + b : a < b ? "▼ down from " + b : "same as") + " last week" : "";
  view.innerHTML = '<p class="muted" style="margin-top:0">' + fmt(w.range.start) + " to " + fmt(w.range.end) + '</p><div class="grid">' +
    (ga.notConnected || ga.error ? '<div class="card" style="grid-column:1/-1">Website numbers aren\\'t connected yet.</div>' :
      '<div class="card"><p class="big">' + ga.visits + '</p>website visits<div class="muted">' + change(ga.visits, ga.visitsLastWeek) + '</div></div>' +
      '<div class="card"><p class="big">' + ga.shopClicks + '</p>clicks into your shop<div class="muted">' + change(ga.shopClicks, ga.shopClicksLastWeek) + '</div></div>') +
    '<div class="card"><p class="big">' + w.leads + '</p>new requests</div>' +
    (ig.notConnected || ig.error ? "" : '<div class="card"><p class="big">' + ig.postsThisWeek + '</p>Instagram posts' + (ig.followers != null ? '<div class="muted">' + ig.followers + ' followers</div>' : "") + '</div>') +
    '</div><div class="card"><h3>What people asked Ask Mello</h3>' + (w.questions.length ? w.questions.map(q => '<div style="margin-top:6px">"' + esc(q) + '"</div>').join("") : '<div class="muted">Nobody chatted this week.</div>') + '</div>';
}

async function events() {
  const ev = await api("/api/events");
  view.innerHTML = '<div class="card"><h3>Add a market or event</h3><div class="muted">The website chat tells customers about it right away.</div>' +
    '<label>Date</label><input type="date" id="d"><label>Event name</label><input id="n" placeholder="Holiday Craft Show"><label>Place</label><input id="p" placeholder="Liberty Borough Fire Hall"><label>Town</label><input id="t" placeholder="Liberty Borough, PA">' +
    '<div class="row"><button class="main" id="add">Add event</button></div><div id="err" class="muted"></div></div>' +
    '<h3 style="margin:18px 0 8px">Coming up</h3>' + (ev.length ? "" : '<p class="empty">Nothing on the calendar yet.</p>');
  for (const e of ev) {
    const c = document.createElement("div"); c.className = "card";
    c.innerHTML = '<span class="tag">' + fmt(e.date) + '</span><h3 style="margin-top:6px">' + esc(e.name) + '</h3><div class="muted">' + esc([e.place, e.town].filter(Boolean).join(", ")) + '</div>' + (e.mine ? '<div class="row"><button>Remove</button></div>' : "");
    if (e.mine) c.querySelector("button").onclick = async () => { if (confirm("Remove " + e.name + "?")) { await api("/api/events", { method: "POST", body: JSON.stringify({ remove: true, date: e.date, name: e.name }) }); show(); } };
    view.appendChild(c);
  }
  document.getElementById("add").onclick = async () => {
    const r = await api("/api/events", { method: "POST", body: JSON.stringify({ date: d.value, name: n.value, place: p.value, town: t.value }) });
    if (r.error) document.getElementById("err").textContent = r.error; else show();
  };
}
show();
</script></body></html>`;
}

export { esc, prettyDate };
