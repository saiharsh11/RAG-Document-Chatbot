"""Central configuration. Everything tunable lives here and can be overridden by env vars."""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _bool(name: str, default: bool) -> bool:
    return _env(name, "1" if default else "0").lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ModelSpec:
    """One model on one provider, with the limits we must respect."""

    provider: str          # "groq" | "openrouter"
    id: str                # provider model id
    label: str
    max_output: int        # hard cap per request (free tiers enforce output-tokens-per-minute)
    supports_tools: bool = True
    extra: dict = field(default_factory=dict)  # provider-specific body params

    @property
    def key(self) -> str:
        return f"{self.provider}:{self.id}"


# ── Models (all open-weight, all free tier) ──────────────────────────────────
GPT_OSS_120B = ModelSpec("groq", "openai/gpt-oss-120b", "GPT-OSS 120B", 2048, extra={"reasoning_effort": "low"})
GPT_OSS_20B = ModelSpec("groq", "openai/gpt-oss-20b", "GPT-OSS 20B", 2048, extra={"reasoning_effort": "low"})
QWEN_27B = ModelSpec("groq", "qwen/qwen3.8-27b", "Qwen 3.8 27B", 900, extra={"reasoning_format": "hidden"})
PROMPT_GUARD = ModelSpec("groq", "meta-llama/llama-prompt-guard-2-86m", "Llama Prompt Guard 2 (Meta)", 16, supports_tools=False)

CHAT_MODELS = [GPT_OSS_120B, GPT_OSS_20B, QWEN_27B]

# Ordered fallback chains per job. Spreading jobs across models spreads the
# per-model tokens-per-minute budget (each model has its own bucket on Groq).
CHAINS: dict[str, list[ModelSpec]] = {
    "answer": [GPT_OSS_120B, QWEN_27B, GPT_OSS_20B],    # final answers, wiki pages
    "research": [GPT_OSS_20B, GPT_OSS_120B, QWEN_27B],  # tool-calling loops
    "verify": [QWEN_27B, GPT_OSS_20B, GPT_OSS_120B],    # critic (different model than the writer)
    "fast": [GPT_OSS_20B, QWEN_27B, GPT_OSS_120B],      # routing, grading, rewrites
}

# Optional extra fallbacks on OpenRouter. Only used if a key is set AND models are listed.
# Every OpenRouter request is pinned to providers that neither store nor train on data.
OPENROUTER_FALLBACKS = [m for m in _env("OPENROUTER_FALLBACK_MODELS", "").split(",") if m]
OPENROUTER_PRIVACY = {"data_collection": "deny", "zdr": True, "allow_fallbacks": True}


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = _env("GROQ_API_KEY", "")
    openrouter_api_key: str = _env("OPENROUTER_API_KEY", "")
    groq_base: str = "https://api.groq.com/openai/v1"
    openrouter_base: str = "https://openrouter.ai/api/v1"

    # Sessions (all in memory, wiped on expiry)
    session_ttl_seconds: int = _int("SESSION_TTL_SECONDS", 10 * 60)
    max_sessions: int = _int("MAX_SESSIONS", 40)
    max_upload_mb: int = _int("MAX_UPLOAD_MB", 50)
    max_docs_per_session: int = _int("MAX_DOCS_PER_SESSION", 10)
    max_pages_per_session: int = _int("MAX_PAGES_PER_SESSION", 2000)

    # Local models (FastEmbed / ONNX, no external API)
    embed_model: str = _env("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
    rerank_model: str = _env("RERANK_MODEL", "jinaai/jina-reranker-v1-turbo-en")  # best on BEIR SciFact, see eval/
    rerank_enabled: bool = _bool("RERANK_ENABLED", True)
    onnx_threads: int = _int("ONNX_THREADS", 2)
    model_cache: str | None = _env("MODEL_CACHE", "") or None  # where ONNX models are downloaded once

    # Retrieval
    retrieve_candidates: int = _int("RETRIEVE_CANDIDATES", 20)
    retrieve_final: int = _int("RETRIEVE_FINAL", 5)
    cag_max_tokens: int = _int("CAG_MAX_TOKENS", 3500)  # whole corpus fits → skip retrieval

    # Agents
    research_max_steps: int = _int("RESEARCH_MAX_STEPS", 5)
    verify_max_rounds: int = _int("VERIFY_MAX_ROUNDS", 1)
    wiki_max_concepts: int = _int("WIKI_MAX_CONCEPTS", 8)

    # Guardrails
    injection_block_threshold: float = float(_env("INJECTION_BLOCK_THRESHOLD", "0.9"))

    # Spend guard (0 = unlimited). Counts tokens across all sessions per UTC day.
    daily_token_budget: int = _int("DAILY_TOKEN_BUDGET", 0)

    # Voice output (Orpheus on Groq; accept its terms once in the Groq console)
    tts_model: str = _env("TTS_MODEL", "canopylabs/orpheus-v1-english")
    tts_voice: str = _env("TTS_VOICE", "autumn")

    # HTTP
    allowed_origins: tuple = tuple(o.strip().rstrip("/") for o in _env("ALLOWED_ORIGINS", "*").split(",") if o.strip())  # browsers send origins without a trailing slash
    rate_limit_per_minute: int = _int("RATE_LIMIT_PER_MINUTE", 30)


settings = Settings()
