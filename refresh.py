"""Refresh each account's long-lived Instagram token (valid 60 days) and print it for the workflow to store."""
import json, os, urllib.request
for acct in json.load(open("accounts.json")):
    tok = os.environ.get(acct["token_secret"], "")
    if not tok or tok.startswith("EAA"):
        print(f"skip {acct['name']}: no token, or a system-user token that never expires"); continue
    url = "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=" + tok
    new = json.load(urllib.request.urlopen(url, timeout=60))["access_token"]
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"{acct['token_secret']}<<EOF\n{new}\nEOF\n")
    print(f"refreshed {acct['name']}")
