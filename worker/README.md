# ATLAS AI proxy

The site's assistant answers with Claude. The Anthropic API key must never be in the public site, so a small
Cloudflare Worker (free plan) holds it and forwards the assistant's requests. Only the ATLAS site can use it,
the model and answer length are fixed in the Worker, and daily caps limit spending.

## Set up (about 5 minutes)

1. **Get an Anthropic API key.** Go to <https://console.anthropic.com/settings/keys>, create a key and copy it
   (`sk-ant-…`). Add billing credit under *Plans & Billing*, and set a monthly spend limit there too.
2. **Create the Worker.** Sign in at <https://dash.cloudflare.com>. Open **Workers & Pages** → **Create** →
   **Create Worker**, name it `atlas-ai`, and click **Deploy**.
3. **Paste the code.** Click **Edit code**, delete everything, paste the contents of
   [`atlas-ai-proxy.js`](atlas-ai-proxy.js), then click **Deploy**.
4. **Add the key.** Go back to the Worker and open **Settings** → **Variables and Secrets** → **Add**.
   Set Type to **Secret**, Name to `ANTHROPIC_API_KEY`, and paste your key as the Value. Click **Deploy**.
5. **Turn on daily caps** (recommended):
   1. Go to **Storage & Databases** → **KV** → **Create**, and name it `atlas-ai-usage`.
   2. Back in the Worker, open **Settings** → **Bindings** → **Add** → **KV namespace**.
   3. Set the variable name to `USAGE` and pick `atlas-ai-usage`.
   4. Optionally add plain-text variables `DAILY_LIMIT` (whole site, default 400 requests a day) and
      `IP_DAILY_LIMIT` (per visitor, default 80).
6. **Copy the Worker URL** shown at the top, e.g. `https://atlas-ai.yourname.workers.dev`. Open it in a
   browser: it should say *ATLAS AI proxy is running.*
7. **Connect the site.** Put that URL in `js/config.js` as `AI_PROXY_URL` and push. Or send the URL to Claude
   and it will do this for you.

If the site moves to another address, add it to the `ALLOWED_ORIGINS` variable (comma-separated). Add
`http://localhost:8080` there too if you want to test locally.

## Cost

Every question costs a few cents or less; questions that pull lots of match data cost more. The two daily caps
and the spend limit in the Anthropic console bound the worst case.
