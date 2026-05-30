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

## Interface

**Room Map** — top-level view shows rooms as nodes arranged by exit direction (north/south/east/west),
connected by edges. Click any room to inspect it in the right panel.

**Enter Room →** — button on each room node drills into a subgraph showing the room's contents:
characters (green), containers (orange), items (purple), and other entities (gray).
Each entity connects from the room header node.

**ECS Inspector** — right panel shows all ECS components attached to the selected entity,
with collapsible sections and inline sub-object expansion. Meter values (hunger, thirst, etc.)
render with a colored progress bar. Relationships list target entities as clickable links
that jump the inspector to that entity.

**Navigation** — breadcrumb at the top shows the current path (Room Map › Room Name).
The Back button and breadcrumb links let you navigate back up.

## Notes

- No build step — single `index.html` file, LiteGraph loaded from CDN.
- Nodes are repositionable; pan with middle-click/right-drag, zoom with scroll wheel.
- The inspector persists the last selected entity when navigating between views.
