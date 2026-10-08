// A small tokenizer for the handful of snippets the dashboard shows. Each
// language is an ordered rule list; the first rule that matches at a position
// wins, and a rule with `inner` has its match tokenized again by those rules.
const STRING = `'(?:\\\\.|[^'\\\\\\n])*'|"(?:\\\\.|[^"\\\\\\n])*"`;

const js = [
  ['comment', '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'],
  ['string', `${STRING}|\`(?:\\\\.|[^\`\\\\])*\``],
  ['keyword', '\\b(?:import|from|export|default|const|let|var|function|return|if|else|for|while|new|await|async|class|throw|try|catch)\\b'],
  ['constant', '\\b(?:true|false|null|undefined|[A-Z][A-Z0-9_]+)\\b'],
  ['number', '\\b\\d[\\d_.]*\\b'],
  ['function', '[A-Za-z_$][\\w$]*(?=\\s*\\()'],
];

const env = [
  ['comment', '(?<=^|\\s)#[^\\n]*'],
  ['constant', '^[A-Za-z_][A-Za-z0-9_]*(?==)'],
  ['string', '(?<==)\\S+'],
];

const html = [
  ['comment', '<!--[\\s\\S]*?-->'],
  [
    null,
    '<\\/?[A-Za-z][^>]*>',
    [
      ['keyword', '(?<=^<\\/?)[A-Za-z][\\w-]*'],
      ['string', STRING],
      ['function', '[A-Za-z_:@][\\w:.-]*'],
    ],
  ],
];

const json = [
  ['constant', '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)'],
  ['string', '"(?:\\\\.|[^"\\\\])*"'],
  ['number', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
  ['constant', '\\b(?:true|false|null)\\b'],
];

function compile(rules) {
  return {
    pattern: new RegExp(rules.map(([, source], i) => `(?<r${i}>${source})`).join('|'), 'gm'),
    rules: rules.map(([type, , inner]) => ({ type, inner: inner && compile(inner) })),
  };
}

const languages = { js: compile(js), env: compile(env), html: compile(html), json: compile(json) };

function tokenize(code, { pattern, rules }, out) {
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const text = match[0];
    if (!text) continue;
    if (match.index > last) out.push({ text: code.slice(last, match.index) });
    const rule = rules[rules.findIndex((_, i) => match.groups[`r${i}`] !== undefined)];
    if (rule.inner) tokenize(text, rule.inner, out);
    else out.push({ type: rule.type, text });
    last = match.index + text.length;
  }
  if (last < code.length) out.push({ text: code.slice(last) });
  return out;
}

// Returns [{ type?, text }]; an unknown language comes back as one plain token.
export function highlight(code, lang) {
  const language = languages[lang];
  return language ? tokenize(code, language, []) : [{ text: code }];
}
