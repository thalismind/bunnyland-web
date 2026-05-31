# Example snapshots

Drop any of these into the inspector (file picker or drag-and-drop) to explore offline.

- **`nested-inventory.json`** — a handcrafted world that exercises the **recursive
  drilldown**. Drill: `Mosslit Burrow` → **Enter Room** → `Clover` (rabbit) →
  **Inventory** → `Leather Satchel` → **Open** → `Tiny Pouch` → **Open** →
  `Sunflower Seed`. Shows rooms containing characters, characters holding containers,
  and containers nested inside other containers. Clover also carries `NeedsComponent`
  meters (hunger/thirst) so the inspector's meter bars are visible. The two characters
  show the **control indicator**: Clover is 🤖 LLM-controlled and Pip is 🎮
  Discord-controlled. They also exercise the **status badges**: Clover is hungry/thirsty
  and content (🍽️ 💧 🙂), while Pip is downed and bleeding (💫 🩸). A third rabbit,
  Bramble, adds relationships for the **Social view**: Clover and Pip are partners (with
  mutual social bonds), Bramble is Pip's parent and jealous of Clover. It also has a quest
  for the **Quests view**: "Find the Lost Carrot" (active) with one done and one pending
  objective, plus an unclaimed reward.

- **`seed-world.json`** — a real snapshot saved from the server (`--seed test`). Two
  connected rooms with characters and ground items; useful as a realistic baseline.
