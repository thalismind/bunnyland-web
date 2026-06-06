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

- **`barbarian-hold.json`** — *Frostpeak Hold*, a larger barbarian world: six rooms
  (great hall, mead hall, war room, forge, training yard, and a one-way trapdoor down to a
  dungeon), five characters across LLM / Discord / suspended control, nested loot (a locked
  war chest holding a runic coffer holding a frost rune), a wed Jarl and shieldmaiden with a
  jealous seer, and the "Reclaim the Frostblade" quest. A captive thrall is downed, bleeding,
  and injured.

- **`scifi-station.json`** — *Derelict Station Kepler-9*, a larger sci-fi world: seven decks
  laid out by ship bearings (fore/aft/port/starboard), a locked reactor blast door and a
  one-way maintenance crawlway, a deactivated android, an injured engineer, a cryosleeping
  colonist, nested cargo (crate → sealed case → data core), and two quests ("Restore Main
  Power", "Wake the Colonists").

- **`regional-hierarchy.json`** — a compact map-scale demo that uses `Contains` edges with
  `mode: "region"` for every regional level: planet → continent → country → region → city
  → area → neighborhood → zone → street → building → story → room.

- **`seed-world.json`** — a real snapshot saved from the server (`--seed test`). Two
  connected rooms with characters and ground items; useful as a realistic baseline.

## Example scripts

Load these in `script-editor.html` with a compatible world snapshot:

- **`scripts/epoch_bell.json`** — once epoch 5 is reached, the first LLM-controlled
  character says a scheduled bell line.

- **`scripts/move_arrival_patch.json`** — after the first `ActorMovedEvent`, patches the
  world by adding a chalk arrival marker in `North Tunnel`.

- **`scripts/llm_only_prompt.json`** — once epoch 10 is reached, every LLM-controlled
  character says a prompt line.

- **`script-world-sets.json`** — example pairings of world generator seed/plugin settings
  with the sample scripts.
