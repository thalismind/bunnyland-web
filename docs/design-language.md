# Bunnyland Web Design Language

This guide documents the shared visual and interaction language for Bunnyland web
clients: the inspector, toon client, world editor, world generator, script editor, and
welcome page. It should keep new UI work consistent without making each client look
identical.

## Principles

- Build operational tools first. Prefer dense, scannable interfaces over marketing
  layouts, large hero treatments, or decorative framing.
- Keep the world visible. Graphs, maps, editor panes, and action lists are the primary
  surfaces; supporting controls should stay compact.
- Use emoji as meaningful iconography. Bunnyland uses Unicode symbols for entity kinds,
  statuses, actions, environment, and navigation. Use them consistently instead of adding
  one-off SVGs.
- Prefer short labels. Important state should be visible, but labels must not compress,
  overlap, or require users to expand nodes to read them.
- Match existing controls before inventing new ones. Reuse shared CSS variables and
  component patterns from `assets/bunnyland-ui.css`.

## Foundation

The shared base style is published by `@bunnyland/ui-web` and synced into this repo as
`assets/bunnyland-ui.css`.

- Theme selection is page-level: `BunnylandUI.setTheme('purple-blue-dark')` applies a
  root class such as `bl-theme-purple-blue-dark`, and that class overrides CSS variables.
  Current palettes are `purple-blue`, `anime`, and `earth`, each with `dark` and `light`
  modes. New colors should become `--bl-*` tokens before page styles depend on them.
- Font: use `--bl-font-mono` for UI text and graph labels.
- Type scale: use `--bl-text-xs`, `--bl-text-sm`, and `--bl-text-md` for dense controls.
- Radius: use `--bl-radius-sm` for controls and compact rows, `--bl-radius-md` for
  modals, menus, cards, and repeated records.
- Surfaces: use `--bl-bg`, `--bl-bg-strong`, `--bl-bg-deep`, `--bl-surface`, and
  `--bl-surface-hover`; avoid new near-duplicate dark colors.
- Borders: use `--bl-border`, `--bl-border-muted`, and `--bl-border-control`.
- Text: use `--bl-text`, `--bl-text-soft`, `--bl-text-muted`, and `--bl-text-dim`.
- Semantic colors: use `--bl-ok`, `--bl-error`, `--bl-warn`, and `--bl-info`.

Client-specific inline CSS may exist for page layout, but should still draw from these
tokens unless a graph node palette or entity palette requires a deliberate exception.

## Layout

- Toolbars are compact, horizontal rows at the top. Use separators and grouped controls
  instead of large page sections.
- Work surfaces fill the remaining viewport. Panes should set `min-width: 0` and
  `min-height: 0` so nested scroll regions behave correctly.
- Side panels should be utilitarian: headers, search/filter controls, lists, and detail
  bodies. Avoid nested cards inside panels.
- Use cards only for repeated records, modal content, or tool-specific framed records
  such as action blocks in the script editor.
- On small screens, preserve access to the primary workflow before secondary metadata.

## Controls

- Buttons are small, monospace, and command-oriented. Labels may include emoji when the
  icon makes repeated actions easier to scan.
- Use familiar symbols for compact actions: `▶`, `⏸`, `⏯`, `↑`, `←`, `x`, `⌖`.
- Use text buttons for destructive or ambiguous commands, such as delete, save, import,
  generate, or connect.
- Keep status text next to the control that produced it when practical. Use `ok` and
  `err` classes or shared semantic colors.
- Do not rely on hover-only explanations. If a state matters, make it readable in the UI.

## Emoji Vocabulary

Use emoji to reinforce meaning, not as decoration.

- Entities: `🏠` room, `🐰` character, `📦` container, `🚪` door, `📜` quest, `🎁` reward.
- Views: `🗺` map, `🌐` regions, `👥` social, `📜` quests.
- Controls: `🚪` enter/go to room, `🎒` inventory, `📦` open, `↑` zoom out, `←` back.
- Controllers: `🤖` LLM, `🎮` Discord, `💤` suspended.
- Status: `💀`, `💫`, `🩸`, `🤕`, `🤰`, `🍽️`, `💧`, `💭`, `🏃`.
- Region characteristics: `👥` population, `🌡️` mild temperature, `❄️` freezing,
  `🧊` deep cold, `🔥` hot, `🌦️` climate, and terrain icons such as `⛰️`, `🌊`,
  `🌳`, `🏜️`, `🏙️`, and `🏢`.

When adding a new emoji, prefer one that can be reused across clients and document it
here when it becomes part of the product language.

## Graph Nodes

Graph nodes are compact summaries, not full inspectors.

- Node title: icon plus display name.
- First body row: stable type/kind, such as `room`, `character`, `continent`, or `city`.
- Additional rows: short state groups only. Prefer multiple short rows over one long row.
- Keep normal-width nodes readable. Users should not need to expand a node to prevent
  label compression.
- Do not use the canvas `fillText` max-width argument as a layout mechanism for long
  labels. It can horizontally squeeze text. Shorten, split, or move data to the inspector.
- Use separate rows for independent metadata groups: type, population/temperature,
  climate, terrain, status badges.
- Put verbose component or edge data in the inspector, not in graph labels.
- Keep graph links visually meaningful but restrained. Edge labels should be rare because
  edge data is inspectable elsewhere.

## Regional Hierarchy

The regional hierarchy is a map-scale graph, so it follows graph-node rules with a few
specific conventions.

- Region type stays visible on the node; no separate legend is required for recognized
  region kinds.
- Recognized tiers use thematic colors: planetary blue, continental green, country gold,
  region teal, city terracotta, local amber, street gray, building blue-gray, and floor
  purple.
- Unknown region kinds use the green fallback.
- Region links inherit source-tier color.
- Static descriptive facts belong on `RegionComponent`: `population`, `climate`, and
  `terrain`. Population is a numeric signpost/gazetteer value, not a live census; the
  node renderer abbreviates it as values like `2.8M`.
- Keep each descriptive row short enough for default node width. The current pattern is
  population/temperature on one row, climate on one row, and terrain on one row.

## Lists And Panels

- List rows use icon, primary label, and muted metadata. Long names should ellipsize in
  list panes.
- Clickable rows should look actionable: use hover/selected states, pointer cursors, and
  clear affordances only when clicking changes selection, navigation, or command state.
- Passive feed rows, logs, and activity entries must not reuse clickable row styling. Make
  the row secondary with subdued background or border treatment, but keep the text at
  normal readable contrast unless the content itself is disabled or unavailable.
- Empty states should be visible where a section matters, such as queued actions.
- Inspector sections should be collapsible and data-dense. Use links for entity ids and
  targets so users can navigate without copying ids.
- Progress bars, badges, and swatches should use semantic or entity palette colors.

## Client Notes

- Inspector: graph and inspector are the core; keep toolbar and legends compact.
- Toon client: prioritize current room, available actions, selected targets, and queued
  actions. Empty queued state should remain visible.
- World editor: forms and JSON panes should preserve dense editing workflows; avoid modal
  flows for routine edits.
- World generator: generation state and logs should stay readable during long-running
  jobs.
- Script editor: action cards are repeated records; keep them flat and scannable.
- Welcome page: it may be friendlier than the tools, but should still use the shared
  palette, compact cards, and direct client links.
