"""The agent loop: the model chooses a tool, observes the result, and decides again.

This is what makes the Researcher, Verifier and Librarian agents rather than
prompt templates: control flow is decided by the model at run time, bounded by a
step budget so a confused model can't loop forever or burn the free-tier quota.
"""

from __future__ import annotations

import json
import time

from app.agents.runtime import Run
from app.llm.client import llm
from app.tools.client import ToolBelt

MAX_TOOL_OUTPUT = 3200


def _summ(args: dict) -> str:
    parts = [f"{k}={v!r}" if not isinstance(v, (list, dict)) else f"{k}=[{len(v)}]" for k, v in args.items()]
    return ", ".join(parts)[:160]


async def run_tool_agent(
    *,
    run: Run,
    agent: str,
    job: str,
    system: str,
    task: str,
    belt: ToolBelt,
    max_steps: int,
    finish_prompt: str,
    max_tokens: int = 900,
) -> str:
    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": task}]
    for step in range(max_steps):
        res = await llm.chat(job, messages, tools=belt.specs, max_tokens=max_tokens,
                             prefer=run.prefer_model if job == "answer" else None, usage=run.usage)
        if not res.tool_calls:
            if res.content.strip():
                run.step(agent, "decided", f"finished after {step} tool call round(s)", model=res.model)
                return res.content
            break
        messages.append({"role": "assistant", "content": res.content or None, "tool_calls": res.tool_calls})
        for i, tc in enumerate(res.tool_calls):
            fn = tc["function"]["name"]
            if i >= 3:  # every tool call needs a reply; cap work per round
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": '{"error":"skipped: max 3 tools per step"}'})
                continue
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            t0 = time.perf_counter()
            out = await belt.call(fn, args)
            run.step(agent, f"tool:{fn}", _summ(args), ms=int((time.perf_counter() - t0) * 1000), model=res.model)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out[:MAX_TOOL_OUTPUT]})

    # Budget exhausted (or empty reply): ask for the final output without tools.
    messages.append({"role": "user", "content": finish_prompt})
    # Tools stay declared (the history contains tool calls) but the model may not use them.
    res = await llm.chat(job, messages, tools=belt.specs, tool_choice="none", max_tokens=max_tokens, usage=run.usage)
    run.step(agent, "decided", "step budget reached, wrapped up", model=res.model)
    return res.content
