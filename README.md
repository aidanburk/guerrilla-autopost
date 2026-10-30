# Guerrilla Autopost

Posts one Instagram image a day for each account in `accounts.json`, using the Instagram API (Instagram Login) and a scheduled GitHub Action.

- `accounts/<name>/posts/*.jpg` and `accounts/<name>/captions.csv` (columns `date`, `file`, `caption`) hold the queue.
- `.github/workflows/post.yml` runs daily at 16:00 UTC and publishes the row whose `date` is today; `posted.log` prevents repeats.
- `.github/workflows/refresh.yml` refreshes each account's long-lived token on the 1st and 15th.

## Secrets (Settings → Secrets and variables → Actions)
- `IG_TOKEN_MELLO`: the @mello.teas access token from the Meta app dashboard.
- `SECRETS_PAT`: a fine-grained personal access token for this repo with **Secrets: read and write**, so the refresh job can save the new token.

## Adding an account
1. Add the Instagram account as an Instagram Tester on the Meta app and generate its token.
2. Add `{ "name": "<name>", "token_secret": "IG_TOKEN_<NAME>" }` to `accounts.json`, a matching secret, and the env line in both workflows.
3. Drop its `posts/` folder and `captions.csv` into `accounts/<name>/`.

Test any time from Actions → Post today → Run workflow (set `dry_run` to 1 to preview).
