---
name: Feature request
about: Propose a new web tool, view, or capability
title: "[feature] "
labels: enhancement
---

## The idea

What you want a Bunnyland web tool to do, in one or two sentences.

## Why

The problem this solves for someone inspecting, editing, or playing a Bunnyland
world from the browser.

## Does it belong in a client?

bunnyland-web is an out-of-tree **client** — views and input surfaces, not a home
for simulation rules. If this needs new server-enforced behavior, an API, or a
schema change, it likely belongs (at least partly) in
[bunnyland-server](../bunnyland-server) first; see its `docs/developer/vision.md`
inclusion rubric. Note here which parts are client-only and which need the server.

## Sketch

Which page/tool, roughly how it behaves, and what server data or API it relies on.
Rough is fine.

## Test angle

How would we prove it works — a unit test for shared logic, a Playwright
regression for the UI, or both?

## Security and hostile data

Does the change render identifiers, labels, URLs, server events, or user-authored text?
How will it preserve same-origin operation and prove that hostile values remain data rather
than markup, script, or navigation?
