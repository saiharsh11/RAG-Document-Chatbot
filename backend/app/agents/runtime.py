"""Per-request runtime: the evidence ledger, usage counter and live event stream.

Agents receive work over A2A, but the *telemetry* of a run (which tool was
called, how long it took) is pushed to this in-process event bus so the UI can
show the agent trail live.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from app.llm.client import Usage
from app.session import Ledger, Session


@dataclass
class Run:
    session: Session
    id: str = field(default_factory=lambda: secrets.token_hex(8))
    ledger: Ledger = field(default_factory=Ledger)
    usage: Usage = field(default_factory=Usage)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    started: float = field(default_factory=time.perf_counter)
    prefer_model: str | None = None
    steps: list[dict] = field(default_factory=list)

    def emit(self, type_: str, **data: Any) -> None:
        event = {"type": type_, "t_ms": int((time.perf_counter() - self.started) * 1000), **data}
        if type_ == "step":
            self.steps.append(event)
        self.queue.put_nowait(event)

    def step(self, agent: str, action: str, detail: str = "", **extra: Any) -> None:
        self.emit("step", agent=agent, action=action, detail=detail[:240], **extra)

    def watch_quota(self) -> None:
        """Report free-tier quota waits for this request in its agent trail."""
        from app.llm.client import on_quota_wait
        on_quota_wait.set(lambda s: self.step("Rate limit", "waiting",
                                              f"free-tier limit reached, retrying in {s:.0f}s"))


class RunRegistry:
    """Lets A2A agent executors find the run a delegated task belongs to."""

    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    def add(self, run: Run) -> None:
        self._runs[run.id] = run

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def remove(self, run_id: str) -> None:
        self._runs.pop(run_id, None)


runs = RunRegistry()
