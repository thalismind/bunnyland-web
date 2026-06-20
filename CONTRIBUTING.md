# Contributing to bunnyland-web

Thanks for helping build the Bunnyland web tools — the snapshot inspector, world
and behavior editors, toon client, and the other browser surfaces that talk to a
running [bunnyland-server](../bunnyland-server). Contributions from people, bots,
and human-supervised agents are all welcome and held to the same bar. Please read
the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## What this repo is (and isn't)

bunnyland-web is an **out-of-tree client**: a collection of static HTML/JS tools
served as plain files. Clients are views and input surfaces — they submit
commands, display projections, and call public or admin APIs. They are **not** the
source of truth for simulation rules. Client-side convenience is fine;
client-side authority is not. If a rule matters, it belongs on the server, not
here. (See the server's `docs/developer/vision.md`.)

No build step, no bundler, no framework — just files you can open. Keep it that
way unless there is a strong reason not to.

## Getting set up

```bash
npm install         # dev tooling: eslint, stylelint, htmlhint, test runner
./serve.sh          # serve the tools at http://localhost:8080
./serve.sh 9000     # custom port
```

Most tools can load a static `snapshot.json` or **Connect Live** to a running
`bunnyland serve` API. See the [README](README.md) for the per-page rundown.

## The contribution loop

1. Branch off `main`.
2. Make the smallest change that proves the behavior; match the surrounding
   style.
3. Add or update tests (unit and/or Playwright — see below).
4. Run the full gate locally.
5. Open a PR using the template, describing what changed and how you verified it.

## Testing standards

Testing is not optional, and the CI gate enforces it. Anything that doesn't lint
clean, pass the unit tests, and pass the Playwright regressions gets rejected.
Hold yourself to the same bar before you push.

### Run the gate

```bash
npm run check       # lint (js + css + html) then unit tests
```

`npm run check` is `npm run lint && npm test`. Individually:

```bash
npm run lint        # eslint + stylelint + htmlhint
npm run lint:js     # eslint over **/*.{js,html}
npm run lint:css    # stylelint over **/*.{css,html}
npm run lint:html   # htmlhint over *.html
npm test            # node --test (shared-script unit tests in test/)
```

### Playwright regressions

User-facing behavior in these tools is covered by Playwright scripts under
`scripts/`. Run the whole suite the way CI does:

```bash
scripts/playwright-all
```

It boots a static server (via `serve.sh`) if one isn't already up, then runs each
`scripts/playwright-*` regression (inspector, world editor, behavior editor,
discord link, toon action form, web TUI, web REPL, trace analyzer). When you add
or change a tool's behavior, add or extend the matching Playwright script and wire
it into `scripts/playwright-all`.

### Real-server regression

`scripts/playwright-release-multiclient` exercises the web client against a real
server container (the `Release Regression` workflow). It is heavier and not part
of the default PR gate, but run it when you touch the live-connection or
multiclient paths.

## Before you open the PR

A change is ready for review when:

- [ ] `npm run check` passes (lint + unit tests).
- [ ] `scripts/playwright-all` passes, with new/updated coverage for changed
      behavior.
- [ ] No build artifacts, `node_modules`, or stray local files are committed.
- [ ] New tool behavior is reachable and documented in the README where users
      will look for it.

## A note on machine-authored changes

LLM agents and scripts are first-class contributors here, held to exactly the
same bar as everyone else — no higher and no lower. The proof is in the lint
output, the unit tests, and the Playwright runs, for human and machine diffs
alike. Mentioning that a tool wrote the patch is a welcome tracing courtesy, not a
disclaimer and not a reason for extra scrutiny. See the
[Code of Conduct](CODE_OF_CONDUCT.md) on machinist non-discrimination.
