export const tryParse = (s: any) => {
  if (typeof s !== 'string') return s;
  const str = s.trim();
  if (!(str.startsWith('{') || str.startsWith('[') || (str.startsWith('"{') && str.endsWith('"')))) return s;
  try { return JSON.parse(s); } catch { try { return JSON.parse(str.replace(/^"|"$/g, '')); } catch { return s; } }
};

export const unwrapPrompt = (raw: any) => {
  let cur: any = raw;
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
