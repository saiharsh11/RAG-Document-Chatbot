"""A2A (Agent2Agent protocol) wiring.

Each specialist agent is an A2A server with its own Agent Card and JSON-RPC
endpoint. The Orchestrator is an A2A client that delegates tasks to them.

Deployment note: all agents currently run inside one FastAPI process and the
client talks to them through an in-process ASGI transport, so a delegation is a
real A2A JSON-RPC exchange without a network hop. Moving an agent to its own
service only requires changing its base URL. The endpoints are internal: every
request must carry a per-process secret, so the public internet cannot call them.
"""

from __future__ import annotations

import logging
import secrets
import uuid

import httpx
from a2a.client import ClientConfig, ClientFactory
from a2a.helpers.proto_helpers import get_data_parts, new_data_message, new_data_part
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers.default_request_handler_v2 import DefaultRequestHandlerV2
from a2a.server.routes import add_a2a_routes_to_fastapi, create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill, Message, Role, SendMessageRequest
from fastapi import FastAPI

from app.agents import specialists
from app.agents.runtime import runs

log = logging.getLogger("a2a")
INTERNAL_BASE = "http://agents.internal"
INTERNAL_TOKEN = secrets.token_urlsafe(32)
PREFIX = "/internal/a2a"

AGENTS = {
    "researcher": dict(
        name="Researcher",
        description="Gathers evidence from the session's documents with hybrid search, query rewriting and section reading.",
        skill=("research", "Research a question", "Decompose a question, search the documents, return cited findings.",
               ["retrieval", "rag", "search"]),
    ),
    "verifier": dict(
        name="Verifier",
        description="Fact-checks a draft answer claim by claim against its cited sources, searching for support when needed.",
        skill=("verify", "Verify an answer", "Return a per-claim verdict and queries for missing evidence.",
               ["fact-checking", "grounding", "self-rag"]),
    ),
    "librarian": dict(
        name="Librarian",
        description="Compiles the session's documents into an interlinked wiki and records contradictions between sources.",
        skill=("build_wiki", "Build the session wiki", "Plan concepts, research and write linked pages with citations.",
               ["wiki", "knowledge-base", "summarisation"]),
        extra_skills=[("studio", "Create study material",
                       "Research a topic, then produce a cited quiz, flashcards, mind map or study guide.",
                       ["education", "quiz", "flashcards", "mind-map"])],
    ),
}


def agent_card(key: str) -> AgentCard:
    a = AGENTS[key]
    sid, sname, sdesc, tags = a["skill"]
    return AgentCard(
        name=a["name"], description=a["description"], version="1.0.0",
        supported_interfaces=[AgentInterface(url=f"{INTERNAL_BASE}{PREFIX}/{key}", protocol_binding="JSONRPC",
                                             protocol_version="1.0")],
        capabilities=AgentCapabilities(streaming=False),
        default_input_modes=["application/json"], default_output_modes=["application/json"],
        skills=[AgentSkill(id=i, name=n, description=d, tags=t)
                for i, n, d, t in [(sid, sname, sdesc, tags), *a.get("extra_skills", [])]],
    )


class SpecialistExecutor(AgentExecutor):
    def __init__(self, key: str) -> None:
        self.key = key

    async def execute(self, context, event_queue) -> None:
        payload = (get_data_parts(context.message.parts) or [{}])[0]
        run = runs.get(payload.get("run_id", ""))
        try:
            if run is None:
                result = {"error": "unknown run"}
            elif self.key == "researcher":
                result = await specialists.researcher(run, payload["question"], payload.get("focus"))
            elif self.key == "verifier":
                result = await specialists.verifier(run, payload["question"], payload["draft"])
            elif payload.get("skill") == "studio":
                result = await specialists.studio(run, payload["kind"], payload.get("topic", ""))
            else:
                result = await specialists.librarian(run)
        except Exception as e:  # report failures as data so the Orchestrator can degrade gracefully
            log.exception("%s agent failed", self.key)
            result = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
        await event_queue.enqueue_event(new_data_message(result, context_id=context.context_id, task_id=context.task_id))

    async def cancel(self, context, event_queue) -> None:  # tasks are short; nothing to cancel
        return None


def mount(app: FastAPI) -> None:
    for key in AGENTS:
        card = agent_card(key)
        handler = DefaultRequestHandlerV2(agent_executor=SpecialistExecutor(key), task_store=InMemoryTaskStore(),
                                          agent_card=card)
        add_a2a_routes_to_fastapi(
            app,
            agent_card_routes=create_agent_card_routes(card, card_url=f"{PREFIX}/{key}/.well-known/agent-card.json"),
            jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url=f"{PREFIX}/{key}"),
        )


def _ints(x):
    """A2A data parts travel as protobuf Struct, where every number is a float."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: _ints(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_ints(v) for v in x]
    return x


class A2ADelegate:
    """The Orchestrator's A2A client."""

    def __init__(self, app: FastAPI) -> None:
        self._http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=INTERNAL_BASE,
                                       headers={"X-Internal-Token": INTERNAL_TOKEN}, timeout=300)
        self._factory = ClientFactory(ClientConfig(httpx_client=self._http, streaming=False))
        self._clients = {k: self._factory.create(agent_card(k)) for k in AGENTS}

    async def send(self, key: str, payload: dict) -> dict:
        msg = Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[new_data_part(payload)])
        async for resp in self._clients[key].send_message(SendMessageRequest(message=msg)):
            if resp.HasField("message"):
                parts = get_data_parts(resp.message.parts)
                return _ints(parts[0]) if parts else {}
            if resp.HasField("task") and resp.task.artifacts:
                parts = get_data_parts(resp.task.artifacts[-1].parts)
                return _ints(parts[0]) if parts else {}
        return {"error": "no response from agent"}

    async def aclose(self) -> None:
        await self._http.aclose()


def public_cards() -> list[dict]:
    """Agent Cards for the /agents endpoint (descriptive only; the endpoints stay internal)."""
    from google.protobuf.json_format import MessageToDict

    out = []
    for key in AGENTS:
        d = MessageToDict(agent_card(key))
        d.pop("supportedInterfaces", None)
        out.append(d)
    return out
