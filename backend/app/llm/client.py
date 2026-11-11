"""LLM client: OpenAI-compatible chat over Groq (and optionally OpenRouter).

Why a thin client instead of a framework wrapper: we need the raw rate-limit
headers to throttle *before* hitting free-tier limits, a per-model circuit
breaker, and exact token accounting for traces and the spend guard.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import httpx

from app.config import CHAINS, OPENROUTER_FALLBACKS, OPENROUTER_PRIVACY, ModelSpec, settings

log = logging.getLogger("llm")


class LLMUnavailable(Exception):
    """Every model in the chain was rate-limited, broken, or over budget."""


@dataclass
class LLMResult:
    content: str
    tool_calls: list[dict]
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0

    def json(self) -> Any:
        return parse_json(self.content)


@dataclass
class _ModelState:
    """Token bucket mirrored from Groq's headers. The per-minute quota refills continuously."""

    remaining_tokens: int | None = None
    limit_tokens: int | None = None
    observed_at: float = 0.0
    tokens_reset_at: float = 0.0

    def available(self, now: float) -> float | None:
        if self.remaining_tokens is None:
            return None
        rate = (self.limit_tokens or 6000) / 60.0
        return min(self.limit_tokens or 1e12, self.remaining_tokens + (now - self.observed_at) * rate)

    def wait_for(self, need: int, now: float) -> float:
        avail = self.available(now)
        if avail is None or avail >= need:
            return 0.0
        if self.limit_tokens and need > self.limit_tokens:
            return float("inf")  # this request can never fit this model
        return (need - avail) / ((self.limit_tokens or 6000) / 60.0)
    cooldown_until: float = 0.0
    failures: int = 0


@dataclass
class Usage:
    """Accumulates usage for one request (shown in the agent trail)."""

    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    by_model: dict = field(default_factory=dict)

    def add(self, r: LLMResult) -> None:
        self.calls += 1
        self.prompt_tokens += r.prompt_tokens
        self.completion_tokens += r.completion_tokens
        m = self.by_model.setdefault(r.model, {"calls": 0, "tokens": 0})
        m["calls"] += 1
        m["tokens"] += r.prompt_tokens + r.completion_tokens

    def as_dict(self) -> dict:
        return {"calls": self.calls, "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens, "by_model": self.by_model}


_DURATION = re.compile(r"(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?")


def _parse_duration(s: str | None) -> float:
    """Groq reset headers look like '7.66s', '1m2.5s' or '250ms'."""
    if not s:
        return 0.0
    m = _DURATION.fullmatch(s.strip())
    if not m:
        try:
            return float(s)
        except ValueError:
            return 0.0
    mins, secs, ms = (float(x) if x else 0.0 for x in m.groups())
    return mins * 60 + secs + ms / 1000


def parse_json(text: str) -> Any:
    """Parse JSON from a model reply, tolerating code fences or leading prose."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}|\[.*\]", text, flags=re.S)
        if m:
            return json.loads(m.group(0))
        raise


def _estimate_tokens(messages: list[dict], max_tokens: int) -> int:
    chars = sum(len(json.dumps(m.get("content") or "")) + len(json.dumps(m.get("tool_calls") or "")) for m in messages)
    return chars // 4 + max_tokens


class LLMClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10))
        self._state: dict[str, _ModelState] = {}
        self._day = ""
        self._day_tokens = 0

    async def aclose(self) -> None:
        await self._http.aclose()

    # ── public API ──────────────────────────────────────────────────────────
    def chain(self, job: str, prefer: str | None = None) -> list[ModelSpec]:
        models = list(CHAINS[job])
        if prefer:
            models.sort(key=lambda m: m.key != prefer and m.id != prefer)
        if settings.openrouter_api_key:
            models += [ModelSpec("openrouter", mid, mid, 1024, extra={"provider": OPENROUTER_PRIVACY})
                       for mid in OPENROUTER_FALLBACKS]
        return models

    async def chat(self, job: str, messages: list[dict], **kw) -> LLMResult:
        """Like _chat_once, but if every model is throttled and a quota frees up soon, wait for it."""
        need = _estimate_tokens(messages, kw.get("max_tokens", 1024))
        for attempt in range(4):
            try:
                return await self._chat_once(job, messages, **kw)
            except LLMUnavailable:
                wait = self._soonest_free(job, need)
                if attempt == 3 or wait is None or wait > 45:
                    raise
                log.info("all models throttled for %s; waiting %.1fs for quota", job, wait)
                await asyncio.sleep(wait + 0.5)
        raise LLMUnavailable("unreachable")

    def _soonest_free(self, job: str, need: int) -> float | None:
        """Seconds until some model in the chain can take a request of `need` tokens."""
        now = time.time()
        waits = []
        for spec in self.chain(job):
            st = self._state.get(spec.key)
            if st is None:
                return 0.0
            waits.append(max(st.cooldown_until - now, st.wait_for(min(need, spec.max_output + need), now)))
        finite = [w for w in waits if w != float("inf")]
        return max(0.0, min(finite)) if finite else None

    async def _chat_once(
        self,
        job: str,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        tool_choice: str | None = None,
        json_mode: bool = False,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        prefer: str | None = None,
        usage: Usage | None = None,
    ) -> LLMResult:
        errors: list[str] = []
        for spec in self.chain(job, prefer):
            if tools and not spec.supports_tools:
                continue
            body = self._body(spec, messages, tools, tool_choice, json_mode, max_tokens, temperature)
            if not self._admit(spec, messages, body["max_tokens"]):
                errors.append(f"{spec.label}: throttled")
                continue
            t0 = time.perf_counter()
            try:
                resp = await self._http.post(self._url(spec), headers=self._headers(spec), json=body)
            except httpx.HTTPError as e:
                self._trip(spec, 20)
                errors.append(f"{spec.label}: {type(e).__name__}")
                continue
            self._observe(spec, resp)
            if resp.status_code != 200:
                errors.append(f"{spec.label}: {resp.status_code} {self._err(resp)[:120]}")
                continue
            data = resp.json()
            msg = data["choices"][0]["message"]
            u = data.get("usage") or {}
            result = LLMResult(
                content=msg.get("content") or "",
                tool_calls=msg.get("tool_calls") or [],
                model=spec.label,
                prompt_tokens=u.get("prompt_tokens", 0),
                completion_tokens=u.get("completion_tokens", 0),
                latency_ms=int((time.perf_counter() - t0) * 1000),
            )
            if json_mode and not result.tool_calls:
                try:
                    parse_json(result.content)
                except (json.JSONDecodeError, ValueError):
                    errors.append(f"{spec.label}: invalid JSON")
                    continue
            self._count(result)
            if usage:
                usage.add(result)
            return result
        raise LLMUnavailable("; ".join(errors) or "no models configured")

    async def stream(
        self,
        job: str,
        messages: list[dict],
        *,
        max_tokens: int = 1200,
        temperature: float = 0.2,
        prefer: str | None = None,
        usage: Usage | None = None,
        on_model: Any = None,
    ) -> AsyncIterator[str]:
        """Stream text deltas. Falls back to the next model only before the first token,
        and waits for quota if every model is throttled."""
        for attempt in range(4):
            got = False
            try:
                async for d in self._stream_once(job, messages, max_tokens=max_tokens, temperature=temperature,
                                                 prefer=prefer, usage=usage, on_model=on_model):
                    got = True
                    yield d
                return
            except LLMUnavailable:
                wait = self._soonest_free(job, _estimate_tokens(messages, max_tokens))
                if got or attempt == 3 or wait is None or wait > 45:
                    raise
                log.info("all models throttled for %s stream; waiting %.1fs", job, wait)
                await asyncio.sleep(wait + 0.5)

    async def _stream_once(self, job, messages, *, max_tokens, temperature, prefer, usage, on_model):
        errors: list[str] = []
        for spec in self.chain(job, prefer):
            body = self._body(spec, messages, None, None, False, max_tokens, temperature)
            body["stream"] = True
            body["stream_options"] = {"include_usage": True}
            if not self._admit(spec, messages, body["max_tokens"]):
                errors.append(f"{spec.label}: throttled")
                continue
            started = False
            t0 = time.perf_counter()
            try:
                async with self._http.stream("POST", self._url(spec), headers=self._headers(spec), json=body) as resp:
                    self._observe(spec, resp)
                    if resp.status_code != 200:
                        await resp.aread()
                        errors.append(f"{spec.label}: {resp.status_code} {self._err(resp)[:120]}")
                        continue
                    if on_model:
                        on_model(spec.label)
                    pt = ct = 0
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        chunk = json.loads(payload)
                        uu = chunk.get("usage") or (chunk.get("x_groq") or {}).get("usage")
                        if uu:
                            pt, ct = uu.get("prompt_tokens", pt), uu.get("completion_tokens", ct)
                        for ch in chunk.get("choices") or []:
                            delta = (ch.get("delta") or {}).get("content")
                            if delta:
                                started = True
                                yield delta
                    r = LLMResult("", [], spec.label, pt, ct, int((time.perf_counter() - t0) * 1000))
                    self._count(r)
                    if usage:
                        usage.add(r)
                    return
            except httpx.HTTPError as e:
                self._trip(spec, 20)
                if started:
                    raise LLMUnavailable(f"{spec.label} dropped mid-stream") from e
                errors.append(f"{spec.label}: {type(e).__name__}")
        raise LLMUnavailable("; ".join(errors) or "no models configured")

    async def classify_injection(self, text: str) -> float | None:
        """Meta's Prompt Guard 2 returns P(prompt injection / jailbreak) as plain text."""
        from app.config import PROMPT_GUARD

        if not self._admit(PROMPT_GUARD, [{"content": text}], 16):
            return None
        try:
            resp = await self._http.post(
                self._url(PROMPT_GUARD), headers=self._headers(PROMPT_GUARD),
                json={"model": PROMPT_GUARD.id, "messages": [{"role": "user", "content": text[:2000]}]},
            )
            self._observe(PROMPT_GUARD, resp)
            if resp.status_code != 200:
                return None
            return float(resp.json()["choices"][0]["message"]["content"].strip())
        except (httpx.HTTPError, ValueError, KeyError):
            return None

    async def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        """Speech-to-text with Whisper on Groq. Audio is sent for transcription only and never stored here."""
        resp = await self._http.post(
            f"{settings.groq_base}/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            data={"model": "whisper-large-v3-turbo", "response_format": "json", "language": "en"},
            files={"file": (filename, audio, content_type)},
        )
        if resp.status_code != 200:
            raise LLMUnavailable(f"Transcription failed: {self._err(resp)[:160]}")
        return resp.json().get("text", "").strip()

    async def speak(self, text: str) -> bytes:
        """Text-to-speech with Orpheus (open-weight) on Groq. Returns WAV bytes."""
        resp = await self._http.post(
            f"{settings.groq_base}/audio/speech",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json={"model": settings.tts_model, "voice": settings.tts_voice, "input": text, "response_format": "wav"},
        )
        if resp.status_code != 200:
            raise LLMUnavailable(f"Speech unavailable: {self._err(resp)[:200]}")
        return resp.content

    def status(self) -> dict:
        now = time.time()
        return {
            k: {"remaining_tokens": s.remaining_tokens,
                "cooling_down": s.cooldown_until > now}
            for k, s in self._state.items()
        } | {"tokens_today": self._day_tokens}

    # ── internals ───────────────────────────────────────────────────────────
    def _body(self, spec, messages, tools, tool_choice, json_mode, max_tokens, temperature) -> dict:
        body: dict[str, Any] = {
            "model": spec.id,
            "messages": messages,
            "max_tokens": min(max_tokens, spec.max_output),
            "temperature": temperature,
            **spec.extra,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice or "auto"
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        return body

    def _url(self, spec: ModelSpec) -> str:
        base = settings.groq_base if spec.provider == "groq" else settings.openrouter_base
        return f"{base}/chat/completions"

    def _headers(self, spec: ModelSpec) -> dict:
        key = settings.groq_api_key if spec.provider == "groq" else settings.openrouter_api_key
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    @staticmethod
    def _err(resp: httpx.Response) -> str:
        try:
            return resp.json().get("error", {}).get("message", resp.text)
        except (ValueError, AttributeError):
            return resp.text

    def _admit(self, spec: ModelSpec, messages: list[dict], max_tokens: int) -> bool:
        """Skip a model that is cooling down or clearly can't fit this request right now."""
        if settings.daily_token_budget and self._today_tokens() >= settings.daily_token_budget:
            raise LLMUnavailable("Daily token budget reached. Try again tomorrow.")
        st = self._state.setdefault(spec.key, _ModelState())
        now = time.time()
        if st.cooldown_until > now:
            return False
        if st.wait_for(_estimate_tokens(messages, max_tokens), now) > 0:
            return False
        return True

    def _observe(self, spec: ModelSpec, resp: httpx.Response) -> None:
        st = self._state.setdefault(spec.key, _ModelState())
        h = resp.headers
        if "x-ratelimit-remaining-tokens" in h:
            try:
                st.remaining_tokens = int(float(h["x-ratelimit-remaining-tokens"]))
                st.observed_at = time.time()
                if "x-ratelimit-limit-tokens" in h:
                    st.limit_tokens = int(float(h["x-ratelimit-limit-tokens"]))
                st.tokens_reset_at = time.time() + _parse_duration(h.get("x-ratelimit-reset-tokens"))
            except ValueError:
                pass
        if resp.status_code == 429:
            wait = _parse_duration(h.get("retry-after")) or _parse_duration(h.get("x-ratelimit-reset-tokens")) or 10
            self._trip(spec, min(max(wait, 2), 60))
        elif resp.status_code >= 500:
            self._trip(spec, 15)
        elif resp.status_code == 200:
            st.failures = 0

    def _trip(self, spec: ModelSpec, seconds: float) -> None:
        st = self._state.setdefault(spec.key, _ModelState())
        st.failures += 1
        st.cooldown_until = time.time() + seconds * min(st.failures, 3)
        log.warning("cooling down %s for %.0fs", spec.label, seconds * min(st.failures, 3))

    def _today_tokens(self) -> int:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if day != self._day:
            self._day, self._day_tokens = day, 0
        return self._day_tokens

    def _count(self, r: LLMResult) -> None:
        self._today_tokens()
        self._day_tokens += r.prompt_tokens + r.completion_tokens


llm = LLMClient()


async def gather_limited(coros, limit: int = 3):
    """Run coroutines with bounded concurrency (keeps us under per-minute limits)."""
    sem = asyncio.Semaphore(limit)

    async def run(c):
        async with sem:
            return await c

    return await asyncio.gather(*(run(c) for c in coros))
