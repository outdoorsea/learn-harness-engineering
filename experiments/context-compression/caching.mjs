// Prompt-caching cost demo — the "cost, not tokens" lever.
//
// The research verdict: caching is the biggest practical win for a black-box API
// consumer, BUT it does NOT reduce the tokens the model reads. The full stable
// prefix is attended over on every request; caching only stores its precomputed
// KV state so you're billed ~0.1x to re-read it instead of full price.
//
// This models N repeated requests that share a large stable prefix (a long system
// prompt / reference doc) plus a small per-request question, WITH vs WITHOUT
// caching, and shows: tokens processed are IDENTICAL; only cost diverges.
//
// Pricing (per the claude-api skill, per 1M tokens). Multipliers are structural:
//   regular input = 1.0x | cache write (5m TTL) = 1.25x | cache read = 0.1x
// Verified against Anthropic prompt-caching docs.
//
// Optional: `--live` with ANTHROPIC_API_KEY sends 2 real requests with
// cache_control and prints the actual usage.cache_* fields (never runs silently).

const PRICES = {
  // input / output USD per 1M tokens
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const WRITE_5M = 1.25; // cache write premium, 5-minute TTL
const READ = 0.1;      // cache read discount (~90% off)

const MODEL = 'claude-opus-4-8';
const STABLE_TOKENS = 10_000; // large reusable prefix (system prompt + reference doc)
const VARIABLE_TOKENS = 50;   // the per-request question (never cacheable — it changes)
const OUTPUT_TOKENS = 200;    // model's answer
const N = 10;                 // repeated requests sharing the prefix

const price = PRICES[MODEL];
const perTok = price.input / 1_000_000;
const outPerTok = price.output / 1_000_000;

// Cost of one request in each regime. Output cost is identical in both.
const outputCost = OUTPUT_TOKENS * outPerTok;

// No caching: full input price for (stable + variable) every request.
function noCacheReq() {
  return (STABLE_TOKENS + VARIABLE_TOKENS) * perTok + outputCost;
}
// Caching: request 1 writes the prefix (1.25x); later requests read it (0.1x).
// The variable question is always full price (it isn't part of the cached prefix).
function cacheReq(index) {
  const stable = index === 0 ? STABLE_TOKENS * perTok * WRITE_5M : STABLE_TOKENS * perTok * READ;
  return stable + VARIABLE_TOKENS * perTok + outputCost;
}

const fmt = (n) => `$${n.toFixed(5)}`;
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(`\nPrompt-caching cost model — ${MODEL}`);
console.log(`stable prefix ${STABLE_TOKENS} tok | question ${VARIABLE_TOKENS} tok | output ${OUTPUT_TOKENS} tok | ${N} requests`);
console.log(`prices: input $${price.input}/Mtok, output $${price.output}/Mtok | write ${WRITE_5M}x, read ${READ}x\n`);

console.log(`${pad('req', 4)}  ${rpad('tokens in', 10)}  ${rpad('no-cache $', 11)}  ${rpad('cache $', 11)}  ${rpad('cum no-cache', 13)}  ${rpad('cum cache', 11)}`);
console.log('-'.repeat(70));

let cumNo = 0, cumCache = 0, breakeven = null;
for (let i = 0; i < N; i++) {
  const tokensIn = STABLE_TOKENS + VARIABLE_TOKENS; // IDENTICAL in both regimes
  const nc = noCacheReq();
  const c = cacheReq(i);
  cumNo += nc;
  cumCache += c;
  if (breakeven === null && cumCache < cumNo) breakeven = i + 1;
  console.log(
    `${pad(i + 1, 4)}  ${rpad(tokensIn, 10)}  ${rpad(fmt(nc), 11)}  ${rpad(fmt(c), 11)}  ${rpad(fmt(cumNo), 13)}  ${rpad(fmt(cumCache), 11)}`
  );
}

const saved = cumNo - cumCache;
const savedPct = Math.round((saved / cumNo) * 100);
console.log('\n' + '-'.repeat(70));
console.log(`tokens the model processed: IDENTICAL in both regimes (${(STABLE_TOKENS + VARIABLE_TOKENS) * N} total in). Caching changed price, not tokens.`);
console.log(`cost after ${N} requests:  no-cache ${fmt(cumNo)}  →  cache ${fmt(cumCache)}   (saved ${fmt(saved)}, -${savedPct}%)`);
console.log(`break-even: caching is cheaper from request #${breakeven} onward (req 1 pays the 1.25x write premium).`);
console.log(`\nThis is the opposite of the compression experiment: there, fewer tokens. here, SAME tokens, lower cost.`);

// --- optional live check -----------------------------------------------------
if (process.argv.includes('--live')) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n--live needs ANTHROPIC_API_KEY. Skipping the real API check.');
    process.exit(1);
  }
  const liveModel = 'claude-haiku-4-5-20251001';
  // Build a stable prefix comfortably above the min cacheable size (~4096 tok for Haiku).
  const prefix = ('The knowledge base indexing service uses incremental updates. ').repeat(400);
  async function ask(question) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: liveModel,
        max_tokens: 50,
        system: [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return (await res.json()).usage;
  }
  console.log(`\n--- live cache check via ${liveModel} ---`);
  const u1 = await ask('Reply with the single word: one.');
  const u2 = await ask('Reply with the single word: two.');
  const show = (label, u) =>
    console.log(`${label}: input=${u.input_tokens} write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0}`);
  show('req 1', u1);
  show('req 2', u2);
  console.log(u2.cache_read_input_tokens > 0
    ? `✓ req 2 read ${u2.cache_read_input_tokens} tokens from cache at 0.1x — same tokens, ~90% cheaper.`
    : `⚠ cache_read was 0 — a silent invalidator changed the prefix between requests.`);
}
console.log();
