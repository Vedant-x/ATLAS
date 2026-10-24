# Contributing to ATLAS

## Run it

```sh
npm ci                 # pinned dependencies; also builds vendor/ (three.js, GSAP, WebLLM)
npm run build          # dist/pages, against the live feeds (about 3 minutes; needs internet)
npm start              # preview on http://127.0.0.1:8080 (the build if there is one, else the source)
```

Without a build, the preview loads fixtures straight from ESPN in the browser. Optional keys and
settings are listed in [.env.example](.env.example).

## Check it

```sh
npm run lint           # ESLint
npm test               # unit tests (node:test)
npm run test:ui        # browser tests on a fixed board (Playwright with Chromium)
npm run check:data     # the data contract, on the last build's data
```

CI runs all of these on every pull request, plus a build against the live feeds and the unit tests at
every hour of the day (time zones and day boundaries break in ways one clock never shows).

## Change it

1. **One branch and one pull request per change.** Keep it to one subject; the pull request template
   asks what changed, why, and how it was checked.
2. **Main is protected:** a change merges only when CI is green, and after review.
3. **Picks and the model:** say what the change does to the record (hit rate, ROI, forecast error). A
   pick list that loses money over a fair sample is retired, not tuned in place.
4. **Data sources:** a new source gets its own module in `scripts/sources/`, appears on the Sources
   page (`noteSource`), and must not take the build down when it fails (it is paused by the breaker,
   and fixtures it gave before are carried forward).
5. **Reversing a decision:** add an entry to [docs/DECISIONS.md](docs/DECISIONS.md) first, with the
   evidence. Features that flip back and forth cost visitors more than they give.
6. **Pages:** nothing only on hover (use `data-tip`), no text under 12 px, controls at 44 px on
   phones. The browser tests check all three.

## Layout

See the README's [Project layout](README.md#project-layout).
