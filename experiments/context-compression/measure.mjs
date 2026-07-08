// Context-compression measurement harness.
//
// Encodes the SAME project-status context five different ways (see encodings.mjs),
// then measures what each one actually costs the model to read.
//
// Metrics:
//   chars     — raw character count (what humans eyeball)
//   gzip      — gzipped bytes (STORAGE compression; the model can't read this)
//   tokens    — BPE tokens (what the model actually ingests & pays for)
//
// Tokenizer note: we use gpt-tokenizer's o200k_base (GPT-4o family) as a PROXY.
// Claude's exact tokenizer isn't public for current models. Absolute counts are
// approximate; the *relative ranking* of encodings is robust across BPE tokenizers.
// Pass --exact with ANTHROPIC_API_KEY set to add a column of exact Claude counts.

import { gzipSync } from 'node:zlib';
import { ENCODINGS } from './encodings.mjs';

let encode;
try {
  ({ encode } = await import('gpt-tokenizer/encoding/o200k_base'));
} catch {
  ({ encode } = await import('gpt-tokenizer'));
}

// Optional: exact Claude token counts via Anthropic's count_tokens endpoint.
// Only runs with --exact AND ANTHROPIC_API_KEY set (never spends money silently).
async function exactClaudeTokens(text) {
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return (await res.json()).input_tokens;
}

const wantExact = process.argv.includes('--exact') && process.env.ANTHROPIC_API_KEY;

const rows = [];
for (const enc of ENCODINGS) {
  const chars = enc.text.length;
  const gzip = gzipSync(enc.text).length;
  const tokens = encode(enc.text).length;
  let exact = null;
  if (wantExact) {
    try { exact = await exactClaudeTokens(enc.text); }
    catch (e) { console.error(`  (exact count failed for ${enc.name}: ${e.message})`); }
  }
  rows.push({ ...enc, chars, gzip, tokens, exact });
}

const raw = rows[0];
const pct = (v, base) => {
  const d = Math.round((1 - v / base) * 100);
  return d === 0 ? '  —' : (d > 0 ? `-${d}%` : `+${-d}%`);
};

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log('\nContext-compression measurement  (tokenizer: o200k_base proxy)');
console.log('same information, five encodings — lower tokens = cheaper for the model\n');

const header = [
  pad('encoding', 14), pad('lossy', 6),
  rpad('chars', 6), rpad('char%', 6),
  rpad('gzipB', 6),
  rpad('tokens', 7), rpad('tok%', 6),
  rpad('tok/char', 9),
];
if (wantExact) header.push(rpad('claude', 7), rpad('cl%', 6));
console.log(header.join('  '));
console.log('-'.repeat(header.join('  ').length));

for (const r of rows) {
  const line = [
    pad(r.name, 14), pad(r.lossy ? 'yes' : 'no', 6),
    rpad(r.chars, 6), rpad(pct(r.chars, raw.chars), 6),
    rpad(r.gzip, 6),
    rpad(r.tokens, 7), rpad(pct(r.tokens, raw.tokens), 6),
    rpad((r.tokens / r.chars).toFixed(3), 9),
  ];
  if (wantExact) {
    line.push(rpad(r.exact ?? '—', 7), rpad(r.exact ? pct(r.exact, raw.exact) : '—', 6));
  }
  console.log(line.join('  '));
}

console.log('\nnotes:');
for (const r of rows) console.log(`  ${pad(r.name, 14)} ${r.note}`);
console.log('\nchar% / tok% are reductions vs raw. tok/char = token density (higher = worse packing).');
if (!wantExact) console.log('run with `--exact` and ANTHROPIC_API_KEY set for exact Claude token counts.');
console.log();
