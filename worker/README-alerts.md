# ATLAS alerts while the site is closed

**Optional.** Without this, alerts for saved matches arrive only while ATLAS is open in a tab. With it, a
visitor who turns on **Alerts while ATLAS is closed** (Watchlist page) gets a phone or desktop notification
when one of their saved matches changes: a starter announced or replaced, a confirmed lineup, a new absence,
a price move or a start-time move. Each notification says what changed and whether the forecast moved with
it.

How it works: a small Cloudflare Worker ([`atlas-alerts.js`](atlas-alerts.js)) stores each visitor's push
subscription, saved matches, quiet hours and time zone. Every 5 minutes it reads the site's change feed
(`data/changes.json`, written by every build) and sends a push to each visitor with a new change for a saved
match. Each change is sent once per visitor; changes during quiet hours are not sent. The push carries no data:
the visitor's browser then asks the Worker for its waiting messages and shows them.

**Cost.** Free on the Cloudflare free plan for a few thousand visitors (KV: 100,000 reads and 1,000 writes a
day; a visitor costs one write only when they have a change).

## Set up (about 10 minutes, free)

1. **Make the keys.** In the repository folder run `node scripts/vapid-keys.mjs`. It prints a public key and a
   private key. Keep the window open. The private key is a secret: don't commit it or paste it anywhere else.
2. **Create a free account** at <https://dash.cloudflare.com/sign-up> (no card), or use the one for `atlas-ai`.
3. **Create the Worker.** **Workers & Pages** → **Create** → **Create Worker**, name it `atlas-alerts`, click
   **Deploy**, then **Edit code**, replace everything with the contents of `atlas-alerts.js`, and **Deploy**.
4. **Storage.** **Storage & Databases** → **KV** → **Create**, name it `atlas-alerts-subs`. In the Worker:
   **Settings** → **Bindings** → **Add** → **KV namespace**, variable name `SUBS`, pick `atlas-alerts-subs`.
5. **Keys and settings.** In the Worker: **Settings** → **Variables and Secrets** → **Add**:
   - `VAPID_PUBLIC` (Text): the public key from step 1.
   - `VAPID_PRIVATE` (**Secret**): the private key from step 1 (the whole `{...}` line).
   - `VAPID_SUBJECT` (Text): `mailto:` and your email address (push services contact this if something is wrong).
   - Optional: `SITE` (default `https://vedant-x.github.io/ATLAS/`) and `ALLOWED_ORIGINS` (comma-separated,
     default the site's origin) if the site moves.
6. **Schedule.** In the Worker: **Settings** → **Trigger events** → **Add** → **Cron trigger**, every 5
   minutes (`*/5 * * * *`).
7. **Check it.** Open the Worker's address (e.g. `https://atlas-alerts.yourname.workers.dev`): it should say
   *ATLAS alerts is running.* Adding `/vapid` should show your public key.
8. **Connect the site.** Put that address in `js/config.js` as `ALERTS_URL` and push, or send it to Claude.

Then on the Watchlist page: **Alerts while ATLAS is closed** → **Turn on**, and allow notifications. On iPhone
and iPad, web notifications work only after **Share** → **Add to Home Screen** and opening ATLAS from there.

## What is stored

Per subscription, under a hash of its push address: the push address, the saved match ids, the chosen quiet
hours, the time-zone offset, the ids of the changes already sent (last 300) and up to 20 waiting messages. No
name, email or IP address. Turning alerts off deletes the record; a push address the browser has dropped is
deleted on the next send.
