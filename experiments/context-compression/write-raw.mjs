// Dumps the canonical `raw` encoding to raw.txt so the Python LLMLingua-2 step
// compresses the exact same source text the JS harness measures (single source
// of truth — no drift between sides).
import { writeFileSync } from 'node:fs';
import { ENCODINGS } from './encodings.mjs';
writeFileSync(new URL('./raw.txt', import.meta.url), ENCODINGS.find((e) => e.name === 'raw').text);
console.log('wrote raw.txt');
