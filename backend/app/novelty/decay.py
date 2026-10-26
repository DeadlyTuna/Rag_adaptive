"""Novelty 5 — learning how fast to forget, from how memories actually get used.

The core pipeline forgets on hand-set time constants (persistent 60 days, important 45,
correction 90, temporary 1.2). Here each class's τ is *fitted* from the memories' own
history, as a survival problem:

  • every gap between two uses of a memory (or creation → first use) is an observed
    "time to next use" — an event;
  • the time since a memory was last used (up to now, or until it was replaced or
    expired) is right-censored — it has not been used again *yet*.

For exponential times the maximum-likelihood rate is events / exposure, so the mean time
to reuse is exposure / events. With few memories that is noisy, so it is shrunk towards
the hand-set prior with A pseudo-events (a Gamma prior on the rate):

    τ_class = (exposure + A · τ_prior) / (events + A),   A = 2

Memories that come up every week then fade on a timescale of weeks; ones that are
rarely needed again fade slower or faster as the data says — and it re-fits as the
conversation goes on. strength = importance × confidence × exp(−Δt / (τ_class · 1.2^uses)).
"""

from __future__ import annotations

from ..forgetting import BASE_TAU
from ..schemas import DecayFit, World

A = 2.0


def fit(world: World, now: int) -> dict[str, DecayFit]:
    out: dict[str, DecayFit] = {}
    for cls, prior in BASE_TAU.items():
        events = 0
        exposure = 0.0
        n = 0
        for m in world.memories:
            if m.cls != cls or m.created_at > now:
                continue
            n += 1
            end = now
            for stop in (m.superseded_at, m.expired_at, m.archived_at):
                if stop is not None:
                    end = min(end, stop)
            times = sorted(t for t in [m.created_at, *m.uses] if t <= end)
            for a, b in zip(times, times[1:]):
                if b > a:
                    events += 1
                    exposure += b - a
            exposure += max(0, end - times[-1]) if times else 0
        tau = (exposure + A * prior) / (events + A)
        out[cls] = DecayFit(tau=round(tau), prior=prior, events=events, exposure=round(exposure), memories=n)
    return out


def taus(world: World) -> dict[str, float] | None:
    return {c: f.tau for c, f in world.decay.items()} or None
