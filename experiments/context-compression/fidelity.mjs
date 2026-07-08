// Fidelity round-trip: does the model still UNDERSTAND each encoding?
//
// Token savings are worthless if the model can't reconstruct the facts. For each
// encoding we feed ONLY that encoding as context, ask the ground-truth questions
// from encodings.mjs, and score whether the answer contains the required facts.
//
// The money-shot table pairs tokens (cost) with fidelity (did it survive):
// a good encoding is small AND still fully answerable.
//
// Requires ANTHROPIC_API_KEY (makes encodings × questions cheap Haiku calls).
// Run `node fidelity.mjs --dry` to print the question bank without calling the API.

import { ENCODINGS, QUESTIONS } from './encodings.mjs';

let encode;
try {
  ({ encode } = await import('gpt-tokenizer/encoding/o200k_base'));
} catch {
  ({ encode } = await import('gpt-tokenizer'));
}

const MODEL = 'claude-haiku-4-5-20251001';
const DRY = process.argv.includes('--dry');

const SYSTEM =
  'You are given a CONTEXT block and a QUESTION. Answer using ONLY the CONTEXT. ' +
  'Be concise — one short sentence. If the context does not state the answer, reply exactly "not stated".';

async function askModel(context, question) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` }],
    }),
  });
  if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.map((b) => b.text ?? '').join(' ').trim();
}

// An answer passes if it contains every string in `all` AND at least one string
// from each group in `any` (case-insensitive).
function passes(answer, question) {
  const a = answer.toLowerCase();
  const allOk = question.all.every((s) => a.includes(s.toLowerCase()));
  const anyOk = question.any.every((group) => group.some((s) => a.includes(s.toLowerCase())));
  return allOk && anyOk;
}

function tokensOf(text) {
  return encode(text).length;
}

// --- dry mode: show the question bank + token cost, no API calls -------------
if (DRY) {
  console.log('\nFidelity question bank (dry run — no API calls)\n');
  for (const q of QUESTIONS) {
    const need = [
      ...q.all.map((s) => `"${s}"`),
      ...q.any.map((g) => `one of {${g.map((s) => `"${s}"`).join(', ')}}`),
    ].join(' AND ');
    console.log(`  [${q.id}] ${q.q}`);
    console.log(`        pass requires: ${need || '(none)'}\n`);
  }
  console.log('token cost per encoding (o200k_base proxy):');
  for (const enc of ENCODINGS) console.log(`  ${enc.name.padEnd(14)} ${tokensOf(enc.text)} tok`);
  console.log('\nset ANTHROPIC_API_KEY and run without --dry to score fidelity.\n');
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Run `node fidelity.mjs --dry` to inspect the question bank,');
  console.error('or set the key to run the live fidelity round-trip.');
  process.exit(1);
}

// --- live scoring ------------------------------------------------------------
console.log(`\nFidelity round-trip via ${MODEL}  (temperature 0)\n`);

const results = [];
for (const enc of ENCODINGS) {
  const answers = await Promise.all(
    QUESTIONS.map(async (q) => {
      try {
        const answer = await askModel(enc.text, q.q);
        return { q, answer, ok: passes(answer, q) };
      } catch (e) {
        return { q, answer: `ERROR: ${e.message}`, ok: false };
      }
    })
  );
  const passed = answers.filter((r) => r.ok).length;
  const failed = answers.filter((r) => !r.ok).map((r) => r.q.id);
  results.push({ enc, tokens: tokensOf(enc.text), passed, total: QUESTIONS.length, failed, answers });
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(`${pad('encoding', 14)}  ${rpad('tokens', 6)}  ${rpad('fidelity', 9)}  failed`);
console.log('-'.repeat(52));
for (const r of results) {
  const fid = `${r.passed}/${r.total}`;
  console.log(`${pad(r.enc.name, 14)}  ${rpad(r.tokens, 6)}  ${rpad(fid, 9)}  ${r.failed.join(', ') || '—'}`);
}

// Detail for any encoding that lost facts.
const lossy = results.filter((r) => r.passed < r.total);
if (lossy.length) {
  console.log('\n--- failed answers (why fidelity dropped) ---');
  for (const r of lossy) {
    console.log(`\n${r.enc.name}:`);
    for (const a of r.answers.filter((x) => !x.ok)) {
      console.log(`  [${a.q.id}] Q: ${a.q.q}`);
      console.log(`         A: ${a.answer}`);
    }
  }
}
console.log('\nbest encoding = high fidelity AT low tokens. lossless size wins are meaningless if fidelity drops.\n');
