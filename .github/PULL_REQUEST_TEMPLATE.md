## What changed

A short description of the change and the request it traces back to.

## Why

The problem this solves, or a link to the issue it closes.

## How it was verified

Spell out how you proved it works — this is the part reviewers lean on, for every
contributor equally.

- [ ] `npm run check` passes (lint + unit tests)
- [ ] `scripts/playwright-all` passes, with new/updated coverage for changed UI
- [ ] No build artifacts, `node_modules`, or stray local files committed
- [ ] New behavior is reachable and noted in the README where users look

Paste relevant test output, new test/Playwright names, or screenshots:

```
# lint / test / playwright output
```

## Notes for reviewers

Anything risky, deferred, or worth a closer look — and a reminder that this is a
client: keep authority on the server, not in the page. If a bot or agent authored
part of this, noting it helps with tracing and reproduction — it is a courtesy,
not a disclaimer, and does not change how the PR is reviewed.
