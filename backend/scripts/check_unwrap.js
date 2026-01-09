// Smoke test for unwrapPrompt parsing logic
const tryParse = (s) => {
  if (typeof s !== 'string') return s;
  const str = s.trim();
  if (!(str.startsWith('{') || str.startsWith('[') || (str.startsWith('"{') && str.endsWith('"')))) return s;
  try { return JSON.parse(s); } catch (e) { try { return JSON.parse(str.replace(/^"|"$/g, '')); } catch (e2) { return s; } }
};

const unwrapPrompt = (raw) => {
  let cur = raw;
  for (let i = 0; i < 8; i++) {
    const p = tryParse(cur);
    if (p === cur) break; else cur = p;
  }
  let depth = 0;
  while (cur && typeof cur === 'object' && 'prompt' in cur && depth < 8) {
    cur = cur.prompt;
    depth++;
    for (let i = 0; i < 4; i++) {
      const p = tryParse(cur);
      if (p === cur) break; else cur = p;
    }
  }
  return cur;
};

const cases = [
  { name: 'plain string', in: 'A raven in a storm', out: 'A raven in a storm' },
  { name: 'simple object', in: JSON.stringify({ prompt: 'A raven' }), out: 'A raven' },
  { name: 'double-stringified', in: JSON.stringify(JSON.stringify({ prompt: 'Nested raven' })), out: 'Nested raven' },
  { name: 'nested prompt prop', in: JSON.stringify({ prompt: JSON.stringify({ prompt: 'Deep raven' }) }), out: 'Deep raven' },
  { name: 'object with urls', in: JSON.stringify({ prompt: 'Scene', urls: ['http://x/1.png'], current: 0 }), out: 'Scene' },
  { name: 'string-wrapped-object-with-escaped', in: '"{\"prompt\":\"Escaped raven\"}"', out: 'Escaped raven' }
];

for (const c of cases) {
  const res = unwrapPrompt(c.in);
  const ok = res === c.out;
  console.log(`${c.name}: ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) console.log('  got:', res, 'expected:', c.out);
}
