# Mello AI

Two free AI pieces for Mello Brands, running as one Cloudflare Worker:

- **Ask Mello**: a chat bubble on melloteas.com. It recommends teas and jerky with Square links, lists upcoming markets, and collects kettle corn catering and wholesale requests, which it emails to Mello.
- **Monday email**: every Monday morning Tomy gets last week's website visits, shop clicks, Instagram posts, new requests, and what customers asked, plus 1 or 2 AI-written to-dos. The numbers are printed by code, and the AI only writes the note.

Everything runs on free plans with no card on file: Cloudflare Workers, Workers AI and KV, plus Resend for email. If a free limit is hit, the service pauses for the day instead of billing. Chat use is capped at `AI_DAILY_CAP` replies per day.

## Files

| File | What it is |
| --- | --- |
| `src/knowledge.js` | Everything the bot knows: products, prices, links, events. **Edit this to update the menu or add markets.** |
| `src/worker.js` | Chat, lead forms, rate limits, report preview |
| `src/widget.js` | The chat bubble (served at `/widget.js`) |
| `src/report.js` | The Monday email |
| `wrangler.toml` | Worker settings: schedule, allowed sites, daily caps |

Pushing to `main` deploys automatically (`.github/workflows/deploy-mello-ai.yml`).

## One-time setup

1. **Cloudflare (free):** sign up at dash.cloudflare.com and open *Workers & Pages* once so it gives you a `*.workers.dev` subdomain. Create an API token from the **Edit Cloudflare Workers** template. In this repo's *Settings → Secrets and variables → Actions*, add:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `CLOUDFLARE_ACCOUNT_ID`: from the right sidebar of the Workers page
   - `MELLO_LEAD_TO`: where requests go (your email while testing, then `melloholdingsllc@gmail.com`)
   - `MELLO_REPORT_TO`: where the Monday email goes (same idea)
   - `MELLO_ADMIN_KEY`: any long random password, used for the preview link below
2. **Resend (free):** sign up at resend.com, add the domain `melloteas.com`, and copy the DNS records it shows into Squarespace DNS. They go on `send.melloteas.com` and `resend._domainkey`, so the existing records stay untouched. Create an API key and add it as the `RESEND_API_KEY` secret. Until the domain is verified, set `MAIL_FROM` in `wrangler.toml` to `Mello AI <onboarding@resend.dev>`; Resend then only delivers to your own signup email.
3. **Google Analytics (free):** in Google Cloud, create a project, enable the *Google Analytics Data API*, create a service account, and download its JSON key. Add the service account's email as a **Viewer** in GA (Admin → Property access management). Add secrets `GA_SA_KEY` (the whole JSON) and `GA_PROPERTY_ID` (Admin → Property details). If shop clicks show 0, put the shop-click event's exact name in `SHOP_EVENT`.
4. **Instagram** reuses the existing `IG_TOKEN_MELLO` and `IG_USER_ID_MELLO` secrets.
5. Run **Actions → Deploy Mello AI → Run workflow**. The log prints the Worker address, for example `https://mello-ai.<you>.workers.dev`.
6. **Framer:** Site Settings → General → Custom Code → *End of `<body>` tag*, paste the snippet below, then Publish:

   ```html
   <script src="https://mello-ai.<you>.workers.dev/widget.js" defer></script>
   ```

## Checking it

- Preview the Monday email: `https://mello-ai.<you>.workers.dev/report?key=<MELLO_ADMIN_KEY>`
- Send it now to yourself: add `&send=1&to=you@example.com`
- Tests: `cd mello-ai && npm ci && npm test`

## Handoff to Mello

In Cloudflare (*Manage account → Members*) and in Resend (*Team*), invite `melloholdingsllc@gmail.com` as admin. After Tomy accepts, remove yourself. Change `MELLO_LEAD_TO` and `MELLO_REPORT_TO` to the Mello Gmail if they aren't already.
