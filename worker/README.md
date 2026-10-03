# ATLAS AI: optional hosted model

**You don't need this.** By default the assistant's AI runs on each visitor's own device (WebLLM in the browser),
so it costs nothing and has no limits. This Worker is for later, if you want a hosted model (for example for
subscribers): set `AI_URL` in `js/config.js` to its address. Whenever it is busy or over a cap, the site quietly
answers on the device instead, so visitors never see a limit.

The site's assistant answers with a real AI model: Meta's Llama 3.3 70B, running on Cloudflare **Workers AI**.
A small Cloudflare Worker ([`atlas-ai.js`](atlas-ai.js)) receives each question together with the relevant
ATLAS data and streams the answer back.

**Cost.** The free Workers plan includes a daily Workers AI allowance (roughly 60–80 questions on the default
model) and needs no card. Beyond that, the paid Workers plan bills per use, so plan it into the subscription
price. When the allowance or the per-visitor cap is reached, the site falls back to the on-device model.

## Set up (about 5 minutes, free)

1. **Create a free account** at <https://dash.cloudflare.com/sign-up>. No card is needed.
2. **Create the Worker.** Open **Workers & Pages** → **Create** → **Create Worker**, name it `atlas-ai`, and
   click **Deploy**.
3. **Paste the code.** Click **Edit code**, delete everything, paste the contents of `atlas-ai.js`, then click
   **Deploy**.
4. **Connect the AI.** Go back to the Worker and open **Settings** → **Bindings** → **Add** → **Workers AI**.
   Set the variable name to `AI`, then click **Deploy**.
5. **Limit each visitor** (recommended, so one person can't use up the day's allowance):
   1. Go to **Storage & Databases** → **KV** → **Create**, and name it `atlas-ai-usage`.
   2. Back in the Worker, open **Settings** → **Bindings** → **Add** → **KV namespace**.
   3. Set the variable name to `USAGE` and pick `atlas-ai-usage`.
   4. Optionally add a plain-text variable `IP_DAILY_LIMIT` (default 40).
6. **Copy the Worker URL** shown at the top, e.g. `https://atlas-ai.yourname.workers.dev`. Open it in a browser:
   it should say *ATLAS AI is running.*
7. **Connect the site.** Put that URL in `js/config.js` as `AI_URL` and push. Or send the URL to Claude and it
   will do this for you.

If the site moves to another address, add it to the `ALLOWED_ORIGINS` variable (comma-separated).
