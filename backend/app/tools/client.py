"""MCP client side: discover tools, expose them to the LLM as function specs, call them."""

from __future__ import annotations

import json

from mcp import Client
from mcp.server.mcpserver import MCPServer


class ToolBelt:
    """An MCP session restricted to an allow-list of tools."""

    def __init__(self, server: MCPServer, allow: list[str]) -> None:
        self._server = server
        self._allow = set(allow)
        self._client: Client | None = None
        self.specs: list[dict] = []

    async def __aenter__(self) -> "ToolBelt":
        self._client = Client(self._server)
        await self._client.__aenter__()
        listed = await self._client.list_tools()
        for t in listed.tools:
            if t.name in self._allow:
                schema = dict(t.input_schema)
                schema.pop("title", None)
                for prop in schema.get("properties", {}).values():
                    prop.pop("title", None)
                self.specs.append({"type": "function", "function": {
                    "name": t.name, "description": (t.description or "").strip(), "parameters": schema}})
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client:
            await self._client.__aexit__(*exc)

    @property
    def names(self) -> list[str]:
        return [s["function"]["name"] for s in self.specs]

    async def call(self, name: str, args: dict) -> str:
        if name not in self._allow:
            return json.dumps({"error": f"Tool {name} is not available to this agent."})
        try:
            r = await self._client.call_tool(name, args)
        except Exception as e:  # bad arguments from the model, etc.
            return json.dumps({"error": f"{type(e).__name__}: {str(e)[:200]}"})
        text = "".join(getattr(c, "text", "") for c in r.content or [])
        if getattr(r, "is_error", False):
            return json.dumps({"error": text[:300]})
        return text


async def with_tools(server: MCPServer, allow: list[str], fn):
    """Run fn(belt) inside an MCP session, re-raising errors *outside* the client's task group
    (otherwise anyio wraps them in an ExceptionGroup and the real cause is hidden)."""
    err: BaseException | None = None
    out = None
    async with ToolBelt(server, allow) as belt:
        try:
            out = await fn(belt)
        except Exception as e:
            err = e
    if err is not None:
        raise err
    return out
