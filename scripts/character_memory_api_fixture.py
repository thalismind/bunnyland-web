#!/usr/bin/env python3
"""Serve a deterministic in-memory Bunnyland API for character-memory Playwright tests."""

from __future__ import annotations

import argparse

import uvicorn

from bunnyland.core import (
    CharacterComponent,
    ContainmentMode,
    Contains,
    FocusPointsComponent,
    IdentityComponent,
    MemoryProfileComponent,
    RoomComponent,
    WorldActor,
    spawn_entity,
)
from bunnyland.memory import InMemoryStore, MemoryEntry, install_memory
from bunnyland.server.app import create_app


class DeterministicMemoryStore(InMemoryStore):
    def add(
        self,
        collection: str,
        *,
        text: str,
        tags: tuple[str, ...] = (),
        created_at_epoch: int = 0,
        source: str = "manual",
    ) -> MemoryEntry:
        entry = MemoryEntry(
            id="note-1",
            text=text,
            tags=tuple(tags),
            created_at_epoch=created_at_epoch,
            source=source,
            metadata={
                "tags": list(tags),
                "created_at_epoch": created_at_epoch,
                "source": source,
            },
        )
        self._collections[collection].append(entry)
        return entry


def build_app(admin_token: str):
    actor = WorldActor()
    world = actor.world
    room = spawn_entity(world, [RoomComponent(title="Memory Test Room")])
    character = spawn_entity(
        world,
        [
            IdentityComponent(name="Juniper", kind="character"),
            CharacterComponent(species="bunny"),
            FocusPointsComponent(current=3.0, maximum=3.0, regen_per_hour=0.5),
            MemoryProfileComponent(
                vector_collection="juniper-private",
                shared_collections=("burrow-board",),
            ),
        ],
    )
    room.add_relationship(Contains(mode=ContainmentMode.ROOM_CONTENT), character.id)
    store = install_memory(actor, DeterministicMemoryStore())
    store.add(
        "juniper-private",
        text="Berries grow north.",
        tags=("forage",),
        created_at_epoch=4,
        source="manual",
    )
    return create_app(actor, admin_token=admin_token)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--admin-token", default="secret")
    args = parser.parse_args()
    uvicorn.run(
        build_app(args.admin_token),
        host=args.host,
        port=args.port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
