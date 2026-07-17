# bunnyland-web

Snapshot debug inspector for [Bunnyland](../bunnyland) world saves.
Loads a JSON world snapshot and displays it as an interactive node graph,
similar to Chrome's memory snapshot tools.

## Usage

1. Generate a snapshot from the server:
   ```
   cd ../bunnyland
   uv run bunnyland serve --seed "my world" --ticks 10 --save world.json
   ```

2. Launch the web tools:
   ```
   ./serve.sh          # serves at http://localhost:8080
   ./serve.sh 9000     # custom port
   ```

3. Open the URL, then use the file picker (or drag-and-drop) to load your `.json` file.
   Or **Connect Live** to a running `bunnyland serve` API. Every client defaults the
   **Server** field to the same-origin `/api/` (which is what the deployed reverse proxy
   serves). For local `serve.sh` (a plain static server with no proxy), point it at your
   running server instead — set the field to `http://localhost:8765` or open with
   `?server=http://localhost:8765`.

4. Open `/script-editor.html` to build external scripting JSON against a loaded world
   snapshot's entity/component library.

5. Open `/world-editor.html` to create or edit a world snapshot directly.

6. Open `/behavior-editor.html` to author behavior-tree JSON for behavioral controllers, and
   optionally connect to a live server to register it.

7. Open `/character-memory.html` to inspect and edit character memory documents on a live
   server.

8. Open `/trace-analyzer.html` to inspect JSON or JSONL trace artifacts produced by the
   release regression tests.

Sample snapshots live in [`examples/`](examples/) — `nested-inventory.json` shows the
recursive room → character → container drilldown; `seed-world.json` is a real server save.

## Playwright checks

Reusable browser checks live in [`scripts/`](scripts/):

```bash
scripts/playwright-all
scripts/playwright-all --coverage  # writes artifacts/playwright-coverage/
```

The aggregate runner starts `serve.sh` automatically. Set `BUNNYLAND_WEB_BASE_URL` and
`BUNNYLAND_WEB_NO_SERVER=1` to point the checks at an already-running server. In CI,
`scripts/playwright-all` enables browser JS/CSS coverage automatically and writes the
merged summary to `artifacts/playwright-coverage/coverage-summary.json`.

## Vite, TypeScript, and Preact

The browser clients are built as a Vite multi-page application. Every existing HTML URL is
an independent build entry, so bookmarks and server links continue to use paths such as
`world-editor.html` and `toon-client.html`; this is not a single-page router.

New UI uses direct `preact` functional components and hooks. All fourteen page entries now
have typed, keyed Preact-owned regions for their highest-update lists and projections. The
Inspector, Trace Analyzer, Character Chat, Character Sheet, Web TUI, and Web REPL also move
their secondary live-update regions without replacing focused inputs or unchanged rows.
Their existing page controllers are temporary adapters so the remaining orchestration can
move in independently verified slices without changing the API or Playwright contracts.
Shared controls and theme behavior come from the pinned, self-contained
`@bunnyland/ui-web` artifact in `vendor/`; builds and tests never import an adjacent source
checkout.

```bash
npm ci
npm run lint     # ESLint for JS/inline scripts, Stylelint for CSS/style blocks, HTMLHint for HTML
npm run typecheck
npm test         # Node helper tests plus Vitest component tests
npm run build    # production multi-page output in dist/
npm run check    # artifact sync + lint + types + tests + production build
```

## API contracts

The room-focused play client (`toon-client.html`) uses only play-zoned contracts and never
touches an admin operation. It discovers selectable characters, renders character and room
projections, reads queued commands, receives live perspective-safe events, and falls back
to the character-scoped recent-event feed. Consult the server OpenAPI document for the
concrete HTTP operations and payloads.
The shared coordinator authenticates in its first WebSocket frame, coalesces event bursts,
deduplicates events by `event_id`, refreshes after a `stream_sequence` gap or `resync`,
refreshes chat/sheet/Toon/TUI/REPL consumers, and resumes fallback polling only while the
stream is unavailable. It never opens the admin-gated global stream or reads the full
administrative snapshot.

Player activity rows render server-disclosed `facts` as supplied. The server has already
applied perspective, privacy, perception, and numeric detail cutoffs; clients must not infer
hidden component state. Action menus likewise use only registry-derived `actions` and
`target_groups`, showing an empty/disabled state if that metadata is unavailable.

The inspector, world editor, and world generator are developer/admin surfaces and remain
snapshot-based because they intentionally need broad world state (and authenticate as admin). Keep new play-facing
server interactions behind named typed request/response contracts and normalize responses
at the client boundary before rendering or submitting commands.

## Container

The published image serves the static client with nginx and proxies same-origin `/api/`
requests to the Bunnyland server:

```bash
docker run --rm -p 8080:80 \
  -e BUNNYLAND_API_UPSTREAM=http://host.docker.internal:8765 \
  ghcr.io/thalismind/bunnyland-web:main
```

The server repo's `compose.yml` wires this image to the server container over Docker DNS.
The default nginx template blocks `/api/admin/`; production deployments should enable that
route only behind authentication.

CI builds and publishes `ghcr.io/thalismind/bunnyland-web` on pushes to `main`, with
branch tags and `latest` for the default branch.

## Configuration

On load the client reads `config.json` (served at the site root, beside the pages) for
deploy-specific settings:

```json
{
  "serverUrl": "/api/",
  "autoConnect": false,
  "theme": "",
  "themes": []
}
```

- `serverUrl` pre-fills the **Server** field so you connect to the right host without
  retyping it.
- `autoConnect` — when `true`, the client also opens the live connection on load;
  when `false` it just fills the field and waits for you to click **Connect Live**.
- `themes` adds deployment-specific theme choices to the shared web theme selector.
  Each entry needs a `value` such as `server-night` and a human-readable `label`;
  serve CSS for `:root.bl-theme-<value>` after `assets/bunnyland-ui.css`.
- `theme` sets the deployment default theme when the visitor has not already saved a
  preference. A URL with `?theme=<value>` overrides both and saves that theme.

Edit `config.json` for your deployment. A missing or invalid file is harmless — the
client falls back to its built-in defaults.

When using the Docker image, set `BUNNYLAND_WEB_THEMES` to the JSON array that should be
rendered into `config.json`, and optionally set `BUNNYLAND_WEB_THEME` to the default value:

```sh
BUNNYLAND_WEB_THEME='server-night'
BUNNYLAND_WEB_THEMES='[{"value":"server-night","label":"Server Night"}]'
```

## Deep links

The URL captures where you are so you can bookmark or share it:

```
?server=<url>#<tab>/<entity>
e.g.  ?server=http://localhost:8765#social/clover
      #map/frost_rune          (no live server — view + entity only)
      #quest                   (just a tab)
```

- `?server=` (query string) is the live server; on load the client fills the **Server**
  field and connects to it. The URL takes precedence over `config.json`.
- `#<tab>/<entity>` (hash) is the active tab (`map` / `social` / `quest`) and the inspected
  entity. On load it selects the entity where it lives, rebuilding the full drilldown path
  for nested ones. The hash updates as you switch tabs and select entities. (A `server=`
  embedded in the hash is also accepted, for links pasted as `#tab/entity?server=…`.)

## Interface

Shared UI conventions are documented in
[`docs/design-language.md`](docs/design-language.md). Use that guide when changing graph
nodes, emoji/iconography, page layout, controls, and cross-client interaction patterns.

**Script editor** — `script-editor.html` uses the same frame as the inspector for a
standalone script authoring page. Load a world snapshot to populate the entity library,
optionally load an existing script JSON, edit named blocks/actions, and download the
resulting script definition as JSON.

**World editor** — `world-editor.html` is a standalone snapshot editor. Start from a new
world, a saved JSON file, or a live server snapshot, then add/update/delete entities,
components, and outgoing edges. It exports the same save-file JSON shape that Bunnyland
uses for persistence.

**World generator** — `world-generator.html` is an admin page for replacing the live world.
It loads enabled generators from the server, accepts a seed/prompt and room budget, calls
the reset generation endpoint, keeps a websocket open, polls snapshots during generation,
and highlights entity ids that appear in the latest snapshot.

**Character memory** — `character-memory.html` is an admin page for inspecting memory-enabled
characters, selecting their private or shared memory collections, and editing document text
plus raw JSON metadata.

**Behavior editor** — `behavior-editor.html` authors the behavior trees that drive
`behavioral` controllers. Build a tree from `sequence`/`selector` composites and
`condition`/`action` leaves, where each leaf references a named entry in the server's leaf
library (`has_visible_objects`, `take_first_item`, `say`, …) with JSON params. It works fully
offline (New / load file / download / copy JSON, with live validation against the built-in
library), and when connected to a server it loads the live `condition`/`action` library plus
the registered behavior names and can POST the tree to `/admin/controllers/behaviors` to
register it without a restart. Sample trees live in
[`examples/behaviors/`](examples/behaviors/).

**Room Map** — top-level view shows rooms as nodes arranged by exit direction (north/south/east/west),
connected by edges. Each room shows a 🐰 count for the characters currently inside it.
Click any room to inspect it in the right panel.

**Social view** — the **Map / Social / Quests** switch flips the top level to a social
graph: every character as a node, with their relationships drawn as colour-coded directed
links — partner, parent of, jealous of, relationship, member of, and social bond (see the
legend). Drilling into a character still works from here.

**Quests view** — shows each quest (📜) as a node with its objectives (◻ ✅ done / ⬜ to do)
and rewards (🎁 claimed / unclaimed) hanging beneath it, matched by quest id. Quest status
and who accepted it appear in the inspector.

**Drilldown** — the button on a node drills into its contents and is **recursive**:
**Enter Room →** a room to see its characters (green), containers (orange), items (purple),
and other entities (gray); **Inventory →** a character to see what it holds and wears;
**Open →** a container to see its contents — including containers nested inside other
containers, to any depth. Each entity connects from the current header node.

**Custom icons** — any entity carrying an `EditorDisplayComponent` shows its `emoji` in
place of the default per-kind icon (🏠/🐰/📦/…) everywhere it appears: graph node titles,
the inspector header, and search results. Entities without one keep the built-in
iconography for their kind.

**Doors** — inside a room, each `ExitTo` exit is drawn as a 🚪 door node labelled with its
direction and destination room, plus a **Go to Room →** button that walks you there. An exit
whose destination has no return path back is flagged **one-way**.

**Control indicator** — characters are tagged with who is driving them, found by following
the `ControlledBy` edge to the controller entity: 🤖 **LLM** (with profile / model), 🎮
**Discord** (with user id), or 💤 **Suspended** (with reason). The badge appears on the
character's node subtitle and, with full detail, on the inspector's kind line.

**Status badges** — characters carry a row of state icons derived from their components:
health/lifecycle (💀 dead, 💫 downed, 🩸 bleeding, 🤕 injured), 🤰 pregnant, needs
(🍽️ hungry, 💧 thirsty — banded by each meter's own thresholds), mood (a face from
`AffectComponent` labels), and 💭 active thoughts. They render on their own row under the
node subtitle; the inspector spells out each label.

**Recent movement** — while connected to a live server, characters that just moved
(an `ActorMovedEvent` within the last ~60 epochs) are flagged with a 🏃 marker and a
highlighted title dot. The flag fades as the world advances and the graph refreshes; it
isn't shown for static snapshots, which carry no event stream.

**Event feed** — toggle **events** in the toolbar to open a live feed under the inspector.
It streams `DomainEvent`s from the connected server (moved, gathered, crafted, downed,
born, …) and primes from the admin recent-event operation on connect. Each row shows the epoch, an
icon, and a one-line summary with the actor linked into the inspector. Updates arrive per
event, independent of the debounced graph refresh.

**ECS Inspector** — right panel shows all ECS components attached to the selected entity,
with collapsible sections and inline sub-object expansion. Meter values (hunger, thirst, etc.)
render with a colored progress bar. Relationships list target entities as clickable links
that jump the inspector to that entity.

**Search / jump-to-entity** — the 🔍 box finds any entity by name, id, type, or kind.
Picking a result jumps to wherever it lives and selects it: rooms and their contents under
the Map view (building the full drilldown path for nested items), quest pieces under the
Quests view. Use ↑/↓ to move through the results and Enter to jump to the highlighted one;
Escape dismisses.

**Navigation** — breadcrumb at the top shows the current path (Room Map › Room Name).
The Back button and breadcrumb links let you navigate back up.

**Parent nodes** — with the **parent nodes** toggle on (default), a drilldown view also
renders the breadcrumb path as a chain of parent nodes flowing into the current entity.
Each carries an entity-appropriate zoom-out button (`↑ Room Map`, `↑ Room`, `↑ Inventory`,
`↑ Contents`) so you can jump back to any ancestor level directly from the graph.

## Notes

- No build step — single `inspector.html` file, LiteGraph loaded from CDN.
- Nodes are repositionable; pan with middle-click/right-drag, zoom with scroll wheel.
- The inspector persists the last selected entity when navigating between views.
