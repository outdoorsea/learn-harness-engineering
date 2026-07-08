"""Compress raw.txt with LLMLingua-2 and save the result as a harness fixture.

LLMLingua-2 (Pan et al., ACL 2024, arXiv:2403.12968) is a token-classification
compressor: a distilled BERT predicts keep/drop per ORIGINAL token by
informativeness. Output is therefore a "gappy" subset of the source text, not a
paraphrase — the honest contrast to our human-written summarized/terse encodings.

Writes:
  llmlingua.txt   the compressed text (becomes the 6th encoding)
  llmlingua.json  stats (its own token counts + ratio) at a couple of rates
"""

import json
from pathlib import Path
from llmlingua import PromptCompressor

HERE = Path(__file__).parent
raw = (HERE / "raw.txt").read_text()

# Smaller multilingual BERT model (~700MB) instead of the 2GB XLM-RoBERTa one.
print("loading LLMLingua-2 model (first run downloads ~700MB)...")
compressor = PromptCompressor(
    model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
    use_llmlingua2=True,
    device_map="cpu",
)

# `rate` = fraction of tokens KEPT (LLMLingua's own tokenizer). rate=0.33 targets
# roughly the ~-67% cut our hand encodings achieved, for a fair head-to-head.
# force_tokens preserves structural punctuation so the output stays readable.
FORCE = ["\n", ".", "?", "!", ":", ","]
stats = {}
canonical = None
for rate in [0.5, 0.33]:
    r = compressor.compress_prompt(raw, rate=rate, force_tokens=FORCE)
    stats[f"rate_{rate}"] = {
        "origin_tokens": r["origin_tokens"],
        "compressed_tokens": r["compressed_tokens"],
        "ratio": r["ratio"],
        "rate": r["rate"],
        "compressed_prompt": r["compressed_prompt"],
    }
    print(f"\n=== rate={rate}  {r['origin_tokens']}->{r['compressed_tokens']} tok ({r['ratio']}) ===")
    print(r["compressed_prompt"])
    if rate == 0.33:
        canonical = r["compressed_prompt"]

(HERE / "llmlingua.txt").write_text(canonical)
(HERE / "llmlingua.json").write_text(json.dumps(stats, indent=2))
print("\nwrote llmlingua.txt (rate=0.33) and llmlingua.json")
