// Sends email through Resend's free plan (3,000/month). Without a key it only logs.

export async function sendEmail(env, { to, subject, html, replyTo }) {
  const list = String(to || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return { skipped: "no recipient set" };
  if (!env.RESEND_API_KEY) {
    console.log("EMAIL (not sent, no RESEND_API_KEY):", subject, list.join(","));
    return { skipped: "no RESEND_API_KEY" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Mello AI <onboarding@resend.dev>",
      to: list,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend failed", res.status, err);
    return { error: `${res.status} ${err.slice(0, 200)}` };
  }
  return { sent: true };
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
