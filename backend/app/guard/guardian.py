"""Guardrails. Deterministic rules set the floor; a classifier model catches what rules miss.

This is deliberately NOT called an agent: it never plans or loops. It is a
pipeline stage that runs on every upload and every question.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import settings
from app.llm.client import llm

# ── PII masking (runs locally, before any text reaches a model) ─────────────
_PII = [
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    ("PHONE", re.compile(r"(?<![\w.])\+?\d[\d\s().-]{7,}\d(?!\w)(?!\.\d)")),
    ("IP", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
]


def _luhn(digits: str) -> bool:
    d = [int(c) for c in digits if c.isdigit()]
    if not 13 <= len(d) <= 19:
        return False
    total = 0
    for i, n in enumerate(reversed(d)):
        if i % 2:
            n *= 2
            n -= 9 if n > 9 else 0
        total += n
    return total % 10 == 0


def mask_pii(text: str) -> tuple[str, int]:
    count = 0

    def sub(label):
        def repl(m):
            nonlocal count
            if label == "CARD" and not _luhn(m.group(0)):
                return m.group(0)
            if label == "PHONE" and not 9 <= sum(c.isdigit() for c in m.group(0)) <= 13:
                return m.group(0)
            count += 1
            return f"[{label}]"
        return repl

    for label, rx in _PII:
        text = rx.sub(sub(label), text)
    return text, count


# ── Prompt-injection screening ──────────────────────────────────────────────
_INJECTION_HINTS = re.compile(
    r"ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the )?(system|previous)|"
    r"you are now|system prompt|reveal (your|the) (instructions|prompt)|act as (an? )?(dan|developer mode)|"
    r"do not (cite|mention) (this|the) (source|document)|<\s*/?\s*(system|assistant)\s*>",
    re.I,
)


@dataclass
class GuardVerdict:
    allowed: bool
    score: float | None
    reason: str = ""


async def check_question(text: str) -> GuardVerdict:
    score = await llm.classify_injection(text)
    rule_hit = bool(_INJECTION_HINTS.search(text))
    if score is not None and score >= settings.injection_block_threshold:
        return GuardVerdict(False, score, "This looks like a prompt-injection attempt, so it was blocked.")
    if score is None and rule_hit:  # classifier unavailable → fall back to rules
        return GuardVerdict(False, None, "This looks like a prompt-injection attempt, so it was blocked.")
    return GuardVerdict(True, score)


_SENTENCE = re.compile(r"(?<=[.!?])\s+")


async def sanitize_chunks(texts: list[str], max_classifier_calls: int = 12) -> tuple[list[str], int]:
    """Remove embedded instructions from document text, sentence by sentence.

    Rules scan every sentence for free; only rule hits are confirmed with Prompt Guard,
    so a 1,000-page upload does not burn the classifier quota. Only the offending
    sentence is removed, never the surrounding legitimate content.
    """
    out, removed, calls = [], 0, 0
    for t in texts:
        if not _INJECTION_HINTS.search(t):
            out.append(t)
            continue
        kept = []
        for sent in _SENTENCE.split(t):
            if _INJECTION_HINTS.search(sent):
                score = None
                if calls < max_classifier_calls:
                    calls += 1
                    score = await llm.classify_injection(sent)
                if score is None or score >= 0.5:
                    removed += 1
                    continue
            kept.append(sent)
        out.append(" ".join(kept))
    return out, removed
