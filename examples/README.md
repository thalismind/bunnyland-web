# Example snapshots

Drop any of these into the inspector (file picker or drag-and-drop) to explore offline.

- **`nested-inventory.json`** — a handcrafted world that exercises the **recursive
  drilldown**. Drill: `Mosslit Burrow` → **Enter Room** → `Clover` (rabbit) →
  **Inventory** → `Leather Satchel` → **Open** → `Tiny Pouch` → **Open** →
  `Sunflower Seed`. Shows rooms containing characters, characters holding containers,
  and containers nested inside other containers. Clover also carries `NeedsComponent`
  meters (hunger/thirst) so the inspector's meter bars are visible. The two characters
  show the **control indicator**: Clover is 🤖 LLM-controlled and Pip is 🎮
  Discord-controlled.

- **`seed-world.json`** — a real snapshot saved from the server (`--seed test`). Two
  connected rooms with characters and ground items; useful as a realistic baseline.
