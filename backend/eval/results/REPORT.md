# Evaluation report

_Generated 2026-11-11 17:04 UTC · 16 labelled questions over a synthetic 41-page corpus (kept out of the public repository)._

## Retrieval (no LLM)

| Variant | hit@1 | hit@5 | recall@5 | MRR@10 |
|---|---|---|---|---|
| dense only | 1.00 | 1.00 | 1.00 | 1.00 |
| BM25 only | 0.94 | 1.00 | 1.00 | 0.97 |
| hybrid (RRF) | 1.00 | 1.00 | 1.00 | 1.00 |
| hybrid + rerank + MMR | 1.00 | 1.00 | 1.00 | 1.00 |

## End to end (real agents on Groq free tier)

_Measured 2026-11-11 12:50 UTC._

| Metric | Value |
|---|---|
| Answer correctness (expected facts present) | 1.00 |
| Citation precision (cited pages are relevant) | 1.0 |
| Faithfulness (LLM judge, claims supported by cited text) | 0.969 |
| Answer relevancy (LLM judge, scaled 0-1) | 1.0 |
| Median latency | 1.79 s |
| Mean LLM calls / tokens per question | 3.188 / 1893.812 |
| Routes taken | {'retrieve': 15, 'research': 1} |
| Errors | 0 of 16 |

## Caveats

- The corpus is synthetic and small; numbers show relative differences between configurations, not real-world accuracy.
- LLM-judge metrics use an open model as the judge and inherit its biases; treat them as indicative.
- End-to-end latency is dominated by free-tier rate limits (8k tokens/min per model).
