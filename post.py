"""Guerrilla Autopost: publish today's post for each account via the Instagram API (Instagram Login).

Each account folder holds posts/*.jpg and captions.csv (columns: date, file, caption; extra columns ignored).
Images are served from this public repo's raw URL, which Instagram fetches when the post is created.
"""
import csv, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

API = "https://graph.instagram.com/v21.0"
REPO = os.environ.get("GITHUB_REPOSITORY", "")
BRANCH = os.environ.get("GITHUB_REF_NAME", "main")
DRY = os.environ.get("DRY_RUN") == "1"
ONLY_DATE = os.environ.get("POST_DATE")  # optional override, YYYY-MM-DD


def call(method, path, **params):
    data = urllib.parse.urlencode(params).encode()
    url = f"{API}/{path}"
    req = urllib.request.Request(url + ("?" + data.decode() if method == "GET" else ""), data=None if method == "GET" else data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} failed: {e.code} {e.read().decode()[:500]}")


def todays_row(folder, day):
    with open(os.path.join(folder, "captions.csv"), encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["date"] == day:
                return row
    return None


def already_posted(folder, day):
    log = os.path.join(folder, "posted.log")
    return os.path.exists(log) and any(line.startswith(day + "\t") for line in open(log))


def publish(acct):
    name, token = acct["name"], os.environ.get(acct["token_secret"], "")
    folder = os.path.join("accounts", name)
    day = ONLY_DATE or datetime.now(ZoneInfo(acct.get("timezone", "America/New_York"))).strftime("%Y-%m-%d")
    row = todays_row(folder, day)
    if not row:
        print(f"[{name}] nothing scheduled for {day}"); return
    if already_posted(folder, day):
        print(f"[{name}] {day} already posted"); return
    image_url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/accounts/{name}/posts/{urllib.parse.quote(row['file'])}"
    print(f"[{name}] {day}: {row['file']}\n  {image_url}")
    if DRY:
        print("  dry run, not posting"); return
    if not token:
        raise SystemExit(f"[{name}] missing secret {acct['token_secret']}")
    me = call("GET", "me", fields="user_id,username", access_token=token)
    uid = me["user_id"]
    created = call("POST", f"{uid}/media", image_url=image_url, caption=row["caption"], access_token=token)
    cid = created["id"]
    for _ in range(20):  # wait for Instagram to finish fetching the image
        st = call("GET", cid, fields="status_code", access_token=token).get("status_code")
        if st == "FINISHED": break
        if st == "ERROR": raise SystemExit(f"[{name}] media container failed")
        time.sleep(6)
    pub = call("POST", f"{uid}/media_publish", creation_id=cid, access_token=token)
    with open(os.path.join(folder, "posted.log"), "a") as f:
        f.write(f"{day}\t{row['file']}\t{pub['id']}\n")
    print(f"  published to @{me['username']}: {pub['id']}")


if __name__ == "__main__":
    for acct in json.load(open("accounts.json")):
        publish(acct)
