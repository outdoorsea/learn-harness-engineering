# Context-compression measurement

Encodes the same project-status context five ways and measures what each costs
the model to read (**tokens**), versus what it costs to *store* (**gzip bytes**)
and what humans eyeball (**chars**). The point: these three do **not** move together.

## Run

```sh
npm install
npm run measure
# exact Claude counts (optional, costs API tokens):
ANTHROPIC_API_KEY=sk-... node measure.mjs --exact
```

The 6th encoding (`llmlingua2`) requires the Python step below; the harness runs
with the first five even if Python isn't set up.

```sh
# generate the LLMLingua-2 fixture (first run downloads ~700MB model)
python3 -m venv .venv && .venv/bin/pip install llmlingua
node write-raw.mjs && .venv/bin/python compress_llmlingua.py
```

## Result (o200k_base proxy tokenizer)

| encoding      | lossy | chars | char% | tokens | tok%  | tok/char | fidelity |
|---------------|-------|-------|-------|--------|-------|----------|----------|
| raw           | no    | 1532  |   —   | 332    |   —   | 0.217    | 6/6      |
| summarized    | yes   | 474   | -69%  | 113    | -66%  | 0.238    | 6/6      |
| terse-schema  | yes   | 392   | -74%  | 110    | -67%  | 0.281    | 6/6      |
| json          | yes   | 787   | -49%  | 254    | -23%  | 0.323    | 6/6      |
| symbolic      | yes   | 292   | -81%  | 147    | -56%  | 0.503    | 6/6*     |
| llmlingua2    | yes   | 408   | -73%  | 106    | -68%  | 0.260    | 4/6      |

Fidelity = ground-truth questions answered correctly (manual pass by a strong
model; run `fidelity.mjs` with an API key for the automated Haiku score).
*`symbolic` is 6/6 only in the best case — a weaker model likely garbles glyphs.

## Takeaways

- **Fewest characters ≠ fewest tokens.** `symbolic` wins on chars (-81%) but its
  glyphs tokenize badly (tok/char 0.503, ~2.3× raw), so it loses on tokens to the
  plain-text encodings.
- **The best encodings are `summarized` and `terse-schema`** (-66 / -67%, 6/6):
  ordinary words the tokenizer packs well, redundancy removed, all facts intact.
- **JSON is token-expensive** (-23% only): braces, quotes, and indentation are all
  tokens carrying no meaning.
- **gzip is irrelevant to the model** — it shrinks storage but must be decoded back
  to tokens before the model reads it, saving nothing in-context.
- **LLMLingua-2 (automated pruning) hits the smallest token count (-68%) but the
  lowest fidelity (4/6):** at rate 0.33 it drops "SQLite" and the "document-ID"
  mechanism and even inverts a reason (prunes "avoids"). To keep all facts it needs
  rate 0.5 = 157 tokens, vs terse-schema's 110 for the same 6/6. This is the classic
  "task-agnostic compression deletes tokens that mattered for a later question."
  NOTE: this is near LLMLingua-2's worst case — a tiny, dense memo. Its real value is
  long, redundant, machine-generated context you can't hand-curate.

## Prompt caching — cost, not tokens (`caching.mjs`)

The research names caching the biggest practical lever for a black-box API user,
with a crucial caveat: it does **not** reduce tokens read. `caching.mjs` models N
repeated requests over a large stable prefix, with vs without caching:

```sh
node caching.mjs              # analytic cost model (offline)
ANTHROPIC_API_KEY=sk-... node caching.mjs --live   # real usage.cache_* fields
```

Result (Opus 4.8, 10k-token prefix, 10 requests): tokens processed are **identical**
in both regimes (100,500 in); cost drops **-71%** ($0.553 → $0.160). Structure:
regular input 1.0×, cache write 1.25×, cache read 0.1×; break-even at request #2.
The `usage` fields split each request into `cache_creation_input_tokens` (write),
`cache_read_input_tokens` (read), and `input_tokens` (uncached) — **all still tokens
the model ingests.** This is the mirror image of the compression experiment: there,
fewer tokens; here, the same tokens at lower cost.
