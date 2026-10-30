// Mello AI: the "Ask Mello" chat on melloteas.com and Tomy's Monday email.
// Runs as one Cloudflare Worker on the free plan (Workers AI + KV + cron).
import { systemPrompt, upcomingEvents, prettyDate } from "./knowledge.js";
import { widget } from "./widget.js";
import { weeklyReport } from "./report.js";
import { sendEmail, esc } from "./email.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_TURNS = 10, MAX_CHARS = 600;
const FALLBACK = "Sorry, I can't answer right now. Call or text 412-901-4372 or email melloholdingsllc@gmail.com and Tomy or Claire will help.";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/widget.js") {
        return new Response(widget(url.origin), {
          headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      }
      if (url.pathname === "/chat" && req.method === "POST") return json(await chat(req, env), cors);
      if (url.pathname === "/lead" && req.method === "POST") return json(await lead(req, env, ctx), cors);
      if (url.pathname === "/report") return await reportRoute(url, env);
      if (url.pathname === "/") return new Response("Ask Mello is running.", { headers: { "content-type": "text/plain" } });
      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ reply: FALLBACK, error: true }, cors, 200);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(weeklyReport(env, { send: true }));
  },
};

// ---------- chat ----------

async function chat(req, env) {
  const body = await req.json().catch(() => ({}));
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!msgs.length || msgs.at(-1).role !== "user") return { reply: "Hi! Ask me anything about Mello teas, jerky or kettle corn." };

  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const today = todayET();
  if (!(await underLimit(env, `rl:chat:${today}:${ip}`, Number(env.CHAT_PER_VISITOR || 40))) ||
      !(await underLimit(env, `rl:ai:${today}`, Number(env.AI_DAILY_CAP || 150)))) {
    return { reply: "I've hit my chat limit for today. " + FALLBACK };
  }

  await logQuestion(env, today, msgs.at(-1).content);

  let text = "";
  try {
    const out = await env.AI.run(MODEL, {
      messages: [{ role: "system", content: systemPrompt(today) }, ...msgs],
      max_tokens: 320,
      temperature: 0.4,
    });
    text = (out && (out.response ?? out.result?.response)) || "";
  } catch (e) {
    console.error("AI error", e);
    return { reply: FALLBACK };
  }
  return parseReply(text);
}

export function parseReply(text) {
  let form = null;
  const m = String(text).match(/\[\[\s*FORM\s*:\s*(catering|wholesale)\s*\]\]/i);
  if (m) form = m[1].toLowerCase();
  const reply = String(text).replace(/\[\[[^\]]*\]\]/g, "").trim() || "Happy to help! What would you like to know?";
  return { reply, form };
}

// ---------- leads (catering / wholesale forms) ----------

const LEAD_FIELDS = {
  catering: [["name", "Name"], ["contact", "Phone or email"], ["date", "Event date"], ["place", "Town or venue"], ["guests", "Guests"], ["kind", "Type of event"], ["notes", "Notes"]],
  wholesale: [["name", "Name"], ["business", "Business"], ["contact", "Phone or email"], ["notes", "What they're interested in"]],
};

async function lead(req, env, ctx) {
  const b = await req.json().catch(() => ({}));
  const type = b.type === "wholesale" ? "wholesale" : "catering";
  if (b.website) return { ok: true }; // honeypot: bots fill hidden fields
  const fields = {};
  for (const [k] of LEAD_FIELDS[type]) fields[k] = String(b[k] ?? "").trim().slice(0, 400);
  if (!fields.name || !fields.contact) return { ok: false, error: "Please add your name and a phone or email." };

  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const today = todayET();
  if (!(await underLimit(env, `rl:lead:${today}:${ip}`, 5))) return { ok: false, error: "Thanks! We already have your request." };

  const rec = { type, at: new Date().toISOString(), ...fields };
  await env.MELLO_KV.put(`lead:${today}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 120 });

  const rows = LEAD_FIELDS[type].filter(([k]) => fields[k]).map(([k, label]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#3a5a43"><b>${label}</b></td><td style="padding:4px 0">${esc(fields[k])}</td></tr>`).join("");
  const title = type === "catering" ? "New kettle corn / catering request" : "New wholesale inquiry";
  const email = /\S+@\S+\.\S+/.test(fields.contact) ? fields.contact.match(/\S+@\S+\.\S+/)[0] : undefined;
  ctx.waitUntil(sendEmail(env, {
    to: env.LEAD_TO,
    subject: `${title}: ${fields.name}`,
    replyTo: email,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f3328">
      <h2 style="color:#bb6438;margin:0 0 12px">${title}</h2>
      <p>Someone filled this out with Ask Mello on melloteas.com.</p>
      <table>${rows}</table>
      <p style="margin-top:16px">${email ? "Hit reply to answer them directly." : "Give them a call or text back."} They were told you'd reach out within a day or two.</p></div>`,
  }));
  return { ok: true };
}

// ---------- report preview / manual send ----------

async function reportRoute(url, env) {
  if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) return new Response("Not found", { status: 404 });
  const send = url.searchParams.get("send") === "1";
  const r = await weeklyReport(env, { send, to: url.searchParams.get("to") || undefined });
  return new Response(r.html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- helpers ----------

export function todayET(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function underLimit(env, key, max) {
  const n = Number((await env.MELLO_KV.get(key)) || 0);
  if (n >= max) return false;
  await env.MELLO_KV.put(key, String(n + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}

async function logQuestion(env, day, text) {
  await env.MELLO_KV.put(`q:${day}:${crypto.randomUUID().slice(0, 8)}`, text.slice(0, 300), { expirationTtl: 60 * 60 * 24 * 40 });
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.some((a) => a === origin || (a.startsWith("*.") && origin.endsWith(a.slice(1))));
  return ok ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" } : { vary: "origin" };
}

function json(obj, headers, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}

export { upcomingEvents, prettyDate };
