"""The glue: how the novelties step into the memory manager (see memory_manager.Hooks).

One NoveltyHooks is made per request by the engine, for the student who is talking, with
the settings' switches. Every method is a no-op for a switched-off novelty.
"""

from __future__ import annotations

import re
from typing import Callable, Optional

from ..config import Settings
from ..memory_manager import Result, event, title_for
from ..schemas import ActivityEvent, Classification, Feedback, Memory, MemoryOp, Turn, View, World, owner_of
from ..slots import slot_def
from . import crowd, intent_weights, propagation, reminders, verify
from .context import statement_valid_from

Neighbours = Callable[[str, int], list[tuple[str, float]]]


class NoveltyHooks:
    def __init__(self, settings: Settings, view: View, neighbours: Optional[Neighbours] = None) -> None:
        self.s = settings
        self.view = view
        self.neighbours = neighbours

    @property
    def user(self) -> str:
        return self.view.user or "harsh"

    # ---- statements -------------------------------------------------------------
    def _applies_to(self, cls: Classification) -> Optional[str]:
        return self.view.department if (self.s.has("scope_time") and cls.scope) else None

    def corroborate(self, world: World, text: str, cls: Classification, now: int) -> Optional[Result]:
        if not self.s.has("multi_user"):
            return None
        return crowd.corroborate(world, text, cls, self.user, self._applies_to(cls), now)

    def annotate(self, world: World, memory: Memory, text: str, cls: Classification, now: int) -> None:
        d = slot_def(cls.slot)
        if self.s.has("multi_user"):
            memory.owner = self.user
            if memory.slot and d and not d.user:
                memory.reporters = [self.user]
        if self.s.has("scope_time"):
            dept = self._applies_to(cls)
            if dept:
                memory.applies_to = dept
                memory.text = re.sub(r"\((?:\w+|your) department\)", f"({dept} department)", memory.text)
            if memory.cls != "temporary" and not (d and d.user):
                memory.valid_from = statement_valid_from(text, now)

    def hold(self, world: World, memory: Memory, text: str, cls: Classification, now: int) -> Optional[Result]:
        if not self.s.has("verify"):
            return None
        v = verify.assess(world, text, cls, self.user)
        if v is None:
            return None
        memory.verification = v
        if v.accepted:
            return None
        memory.status = "pending"
        src = verify.contradicted_source(world, cls)
        where = src[3] if src else "a trusted source"
        ops = [
            MemoryOp(
                kind="quarantine",
                memory_id=memory.id,
                title=memory.text,
                detail=f"Held for verification — it contradicts {where} (score {v.score:.2f} < {v.threshold:.2f})",
                subject=where,
            )
        ]
        e = event("memory.quarantined", now, "Correction held for verification", f"{memory.text} · contradicts {where} · score {v.score:.2f}", memory.id)
        return ops, [e]

    def keeps_shared(self, world: World, conflict_id: str, memory: Memory) -> bool:
        """With many students, a private correction never outdates a fact someone else
        (or a document) stands behind — it only takes precedence for its author."""
        if not self.s.has("multi_user"):
            return False
        old = world.memory(conflict_id)
        return bool(old) and owner_of(old) != owner_of(memory)

    def stored(self, world: World, memory: Memory, now: int) -> list[ActivityEvent]:
        if self.s.has("reminders"):
            reminders.schedule(world, memory, now)
        return []

    # ---- feedback ---------------------------------------------------------------
    def feedback(self, world: World, turn: Turn, fb: Feedback, preferred, rejected, cited, others) -> list[ActivityEvent]:
        events: list[ActivityEvent] = []
        group = turn.retrieval.intent_group if turn.retrieval else None
        if self.s.has("intent_weights") and group:
            if fb.verdict == "helpful":
                learned = intent_weights.learn(world, group, cited=cited, others=others)
            else:
                learned = intent_weights.learn(world, group, preferred=preferred, rejected=rejected)
            if learned:
                fb.intent_group = group
        if self.s.has("propagation") and fb.reliability and self.neighbours:
            reason = fb.reason or ("helpful" if fb.verdict == "helpful" else "wrong_source")
            spread = propagation.propagate(world, fb.reliability, reason, self.neighbours)
            if spread:
                fb.propagated = spread
                detail = ", ".join(f"{title_for(world, r.id)} {r.from_:.2f} → {r.to:.2f}" for r in spread)
                e = event("trust.propagated", fb.at, "Trust spread to similar passages", detail, fb.reliability.id)
                events.append(e)
        return events

