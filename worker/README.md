# ATLAS AI (free)

The site's assistant answers with a real AI model: Meta's Llama 3.3 70B, running on Cloudflare **Workers AI**.
A small Cloudflare Worker ([`atlas-ai.js`](atlas-ai.js)) receives each question together with the relevant
ATLAS data and streams the answer back.

**It costs nothing.** The free Workers plan includes a daily Workers AI allowance and needs no card, so
nothing can ever be charged. When the day's allowance runs out, the assistant says so and works again after
midnight UTC. That's roughly 60–80 questions a day on the default model. Set `MODEL` to
`@cf/meta/llama-3.1-8b-instruct-fast` for several hundred a day, with simpler answers.

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
