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

2. Launch the inspector:
   ```
   ./serve.sh          # serves at http://localhost:8080
   ./serve.sh 9000     # custom port
   ```

3. Open the URL, then use the file picker (or drag-and-drop) to load your `.json` file.
   Or **Connect Live** to a running `bunnyland serve` API (default `http://localhost:8765`)
   to stream the world and refresh on events.

Sample snapshots live in [`examples/`](examples/) — `nested-inventory.json` shows the
recursive room → character → container drilldown; `seed-world.json` is a real server save.

## Configuration

On load the client reads `config.json` (next to `index.html`) for deploy-specific
settings:

```json
{
  "serverUrl": "http://localhost:8765",
  "autoConnect": false
}
```

- `serverUrl` pre-fills the **Server** field so you connect to the right host without
  retyping it.
- `autoConnect` — when `true`, the client also opens the live connection on load;
  when `false` it just fills the field and waits for you to click **Connect Live**.

Edit `config.json` for your deployment. A missing or invalid file is harmless — the
client falls back to its built-in defaults.

## Interface

**Room Map** — top-level view shows rooms as nodes arranged by exit direction (north/south/east/west),
connected by edges. Click any room to inspect it in the right panel.

**Drilldown** — the button on a node drills into its contents and is **recursive**:
**Enter Room →** a room to see its characters (green), containers (orange), items (purple),
and other entities (gray); **Inventory →** a character to see what it holds and wears;
**Open →** a container to see its contents — including containers nested inside other
containers, to any depth. Each entity connects from the current header node.

**Doors** — inside a room, each `ExitTo` exit is drawn as a 🚪 door node labelled with its
direction and destination room, plus a **Go to Room →** button that walks you there. An exit
whose destination has no return path back is flagged **one-way**.

**Control indicator** — characters are tagged with who is driving them, found by following
the `ControlledBy` edge to the controller entity: 🤖 **LLM** (with profile / model), 🎮
**Discord** (with user id), or 💤 **Suspended** (with reason). The badge appears on the
character's node subtitle and, with full detail, on the inspector's kind line.

**Recent movement** — while connected to a live server, characters that just moved
(an `ActorMovedEvent` within the last ~60 epochs) are flagged with a 🏃 marker and a
highlighted title dot. The flag fades as the world advances and the graph refreshes; it
isn't shown for static snapshots, which carry no event stream.

**ECS Inspector** — right panel shows all ECS components attached to the selected entity,
with collapsible sections and inline sub-object expansion. Meter values (hunger, thirst, etc.)
render with a colored progress bar. Relationships list target entities as clickable links
that jump the inspector to that entity.

**Navigation** — breadcrumb at the top shows the current path (Room Map › Room Name).
The Back button and breadcrumb links let you navigate back up.

**Parent nodes** — with the **parent nodes** toggle on (default), a drilldown view also
renders the breadcrumb path as a chain of parent nodes flowing into the current entity.
Each carries an entity-appropriate zoom-out button (`↑ Room Map`, `↑ Room`, `↑ Inventory`,
`↑ Contents`) so you can jump back to any ancestor level directly from the graph.

## Notes

- No build step — single `index.html` file, LiteGraph loaded from CDN.
- Nodes are repositionable; pan with middle-click/right-drag, zoom with scroll wheel.
- The inspector persists the last selected entity when navigating between views.
