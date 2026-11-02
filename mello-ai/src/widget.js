// The "Ask Mello" chat bubble. Served at /widget.js; Framer loads it with one <script> tag.
// Written as a plain function so it stays readable; the Worker serves its source with the API address filled in.

export function widget(api) {
  return `(${askMello.toString()})(${JSON.stringify(api)});`;
}

function askMello(API) {
  if (window.__askMello) return;
  window.__askMello = true;

  const C = { green: "#1f3328", sage: "#3a5a43", terra: "#bb6438", gold: "#d99a4e", cream: "#fbf6ec", paper: "#fffdf8" };
  const SAFE = /^https:\/\/(www\.)?(melloteas\.com|mello-teas\.square\.site)(\/[^\s]*)?$/;
  const track = (name) => { try { window.gtag && window.gtag("event", name); } catch (e) {} };
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem("askMello") || "[]"); } catch (e) { return []; } },
    set(v) { try { sessionStorage.setItem("askMello", JSON.stringify(v.slice(-20))); } catch (e) {} },
  };

  const host = document.createElement("div");
  host.id = "ask-mello";
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:"Nunito Sans",system-ui,-apple-system,Segoe UI,Arial,sans-serif}
    .btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:12px 18px;border:0;border-radius:999px;background:${C.terra};color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(31,51,40,.25)}
    .btn:hover{background:#a8562f}
    .btn svg{width:20px;height:20px}
    .panel{position:fixed;right:20px;bottom:84px;z-index:2147483001;width:360px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:${C.paper};border-radius:18px;overflow:hidden;box-shadow:0 16px 48px rgba(31,51,40,.3);border:1px solid #e8dfcc}
    .panel.open{display:flex}
    header{background:${C.green};color:${C.cream};padding:14px 16px;display:flex;align-items:center;gap:10px}
    header b{font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:600;display:block}
    header small{opacity:.8;font-size:12.5px}
    header button{margin-left:auto;background:none;border:0;color:${C.cream};font-size:22px;cursor:pointer;line-height:1;padding:4px}
    .log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:${C.cream}}
    .m{max-width:85%;padding:9px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
    .bot{background:#fff;color:${C.green};align-self:flex-start;border:1px solid #eee3cf;border-bottom-left-radius:4px}
    .me{background:${C.sage};color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
    .m a{color:${C.terra};font-weight:700}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{border:1px solid ${C.terra};color:${C.terra};background:#fff;border-radius:999px;padding:6px 11px;font-size:13px;cursor:pointer;font-weight:600}
    .chip:hover{background:${C.terra};color:#fff}
    form.lead{background:#fff;border:1px solid #eee3cf;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;align-self:stretch}
    form.lead b{color:${C.green};font-size:14.5px}
    form.lead input,form.lead textarea{width:100%;border:1px solid #d9cfba;border-radius:8px;padding:8px 10px;font-size:14px;color:${C.green};background:${C.paper}}
    form.lead textarea{min-height:56px;resize:vertical}
    form.lead .row{display:flex;gap:8px}
    form.lead button{background:${C.terra};color:#fff;border:0;border-radius:8px;padding:10px;font-weight:700;font-size:14px;cursor:pointer}
    form.lead .err{color:#a33;font-size:13px;min-height:0}
    .hp{position:absolute;left:-9999px}
    .send{display:flex;gap:8px;padding:10px;border-top:1px solid #eee3cf;background:${C.paper}}
    .send input{flex:1;border:1px solid #d9cfba;border-radius:999px;padding:10px 14px;font-size:14.5px;color:${C.green};background:#fff}
    .send button{border:0;background:${C.green};color:#fff;border-radius:999px;width:42px;height:42px;cursor:pointer;font-size:18px}
    .typing{opacity:.6;font-style:italic}
    .foot{font-size:11px;color:#7a8a7e;text-align:center;padding:0 10px 8px;background:${C.paper}}
    @media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.btn{right:14px;bottom:14px}}
  </style>
  <button class="btn" aria-label="Open Ask Mello chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/></svg>Ask Mello</button>
  <section class="panel" role="dialog" aria-label="Ask Mello chat">
    <header><div><b>Ask Mello</b><small>Teas, jerky, kettle corn &amp; events</small></div><button class="x" aria-label="Close">&times;</button></header>
    <div class="log" aria-live="polite"></div>
    <form class="send"><input placeholder="Ask about teas, jerky, events..." aria-label="Your message" maxlength="500"><button aria-label="Send">&#10148;</button></form>
    <div class="foot">AI assistant. For anything urgent call 412-901-4372.</div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const panel = $(".panel"), log = $(".log"), input = $(".send input");
  let history = store.get();
  let busy = false;

  function addText(el, text) {
    // Plain text, with links only to Mello's own site and shop.
    String(text).split(/(https:\/\/[^\s)]+)/g).forEach((part) => {
      const clean = part.replace(/[.,!?]+$/, "");
      if (SAFE.test(clean)) {
        const a = document.createElement("a");
        a.href = clean; a.target = "_blank"; a.rel = "noopener";
        a.textContent = /square\.site/.test(clean) ? "Shop it here" : clean.replace(/^https:\/\/(www\.)?/, "");
        el.appendChild(a);
        if (part.length > clean.length) el.appendChild(document.createTextNode(part.slice(clean.length)));
      } else el.appendChild(document.createTextNode(part));
    });
  }
  function bubble(role, text) {
    const d = document.createElement("div");
    d.className = "m " + (role === "user" ? "me" : "bot");
    addText(d, text);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function chips() {
    const wrap = document.createElement("div");
    wrap.className = "chips";
    [["Help me pick a tea", () => ask("Can you help me pick a tea?")],
     ["Where are you next?", () => ask("Where will you be next?")],
     ["Book kettle corn", () => form("catering")],
     ["Wholesale", () => form("wholesale")]].forEach(([label, fn]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = label; b.onclick = fn;
      wrap.appendChild(b);
    });
    log.appendChild(wrap);
  }
  function form(type) {
    track("ask_mello_form_" + type);
    const f = document.createElement("form");
    f.className = "lead";
    const cat = type === "catering";
    f.innerHTML = `<b>${cat ? "Kettle corn for your event" : "Carry Mello in your shop"}</b>
      <input name="name" placeholder="Your name" required maxlength="100">
      ${cat ? "" : '<input name="business" placeholder="Business name" maxlength="120">'}
      <input name="contact" placeholder="Phone or email" required maxlength="120">
      ${cat ? `<div class="row"><input name="date" placeholder="Event date" maxlength="60"><input name="guests" placeholder="# of guests" maxlength="20"></div>
      <input name="place" placeholder="Town or venue" maxlength="120">
      <input name="kind" placeholder="Type of event (party, school, church...)" maxlength="120">` : ""}
      <textarea name="notes" placeholder="${cat ? "Anything else? (optional)" : "What are you interested in?"}" maxlength="400"></textarea>
      <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="err"></div>
      <button>Send to Tomy &amp; Claire</button>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f));
      data.type = type;
      const btn = f.querySelector("button"), err = f.querySelector(".err");
      btn.disabled = true; btn.textContent = "Sending...";
      try {
        const r = await fetch(API + "/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json());
        if (!r.ok) throw new Error(r.error || "Something went wrong.");
        f.remove();
        track("ask_mello_lead_" + type);
        say("Thank you, " + String(data.name).split(" ")[0] + "! Tomy or Claire will reach out within a day or two" + (cat ? " to talk about your event." : "."));
      } catch (ex) {
        err.textContent = (ex && ex.message) || "Couldn't send. Please call 412-901-4372.";
        btn.disabled = false; btn.textContent = "Send to Tomy & Claire";
      }
    };
    log.appendChild(f);
    log.scrollTop = log.scrollHeight;
    f.querySelector("input").focus();
  }
  function say(text) {
    bubble("assistant", text);
    history.push({ role: "assistant", content: text });
    store.set(history);
  }
  async function ask(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    busy = true;
    bubble("user", text);
    history.push({ role: "user", content: text });
    store.set(history);
    const wait = bubble("assistant", "Thinking...");
    wait.classList.add("typing");
    try {
      const r = await fetch(API + "/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.slice(-10) }) }).then((r) => r.json());
      wait.remove();
      say(r.reply);
      if (r.form) form(r.form);
    } catch (e) {
      wait.remove();
      say("Sorry, I couldn't connect. Call or text 412-901-4372, or email melloholdingsllc@gmail.com.");
    }
    busy = false;
  }

  function open() {
    panel.classList.add("open");
    if (!log.childElementCount) {
      bubble("assistant", "Hi! I'm Ask Mello. I can help you pick a tea, find us at a market, or book kettle corn for your event.");
      history.forEach((m) => bubble(m.role, m.content));
      chips();
    }
    track("ask_mello_open");
    setTimeout(() => input.focus(), 50);
  }
  $(".btn").onclick = () => (panel.classList.contains("open") ? panel.classList.remove("open") : open());
  $(".x").onclick = () => panel.classList.remove("open");
  $(".send").onsubmit = (e) => { e.preventDefault(); const t = input.value; input.value = ""; ask(t); };
}
