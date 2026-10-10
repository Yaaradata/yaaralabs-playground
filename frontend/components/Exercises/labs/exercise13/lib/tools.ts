/** Exact arithmetic, unit conversion, and answer-checking for Exercise 13. */

export type CalcValue = number | bigint;

const NOT_EXACT = new Error('not exact');

type Token =
  | { t: 'n'; v: string }
  | { t: 'id'; v: string }
  | { t: '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')' };

type Node =
  | { num: string }
  | { const: number }
  | { fn: string; a: Node }
  | { op: string; a: Node; b?: Node };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const src = String(s)
    .replace(/[−–]/g, '-')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .replace(/(\d|\))\s*[x×✕·]\s*(?=[\d(.])/gi, '$1*')
    .replace(/[×✕·]/g, '*')
    .replace(/%\s*of\b/gi, '%*');
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = src.slice(i).match(/^(\d[\d,_]*(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (num) {
      out.push({ t: 'n', v: num[0].replace(/[,_]/g, '') });
      i += num[0].length;
      continue;
    }
    const id = src.slice(i).match(/^[a-z_][a-z0-9_]*/i);
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/^%()'.includes(c)) {
      out.push({ t: c as '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

function parse(tokens: Token[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t: string) => {
    if (peek() && peek().t === t) {
      p++;
      return true;
    }
    return false;
  };
  const expr = (): Node => {
    let n = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[p++].t;
      n = { op, a: n, b: term() };
    }
    return n;
  };
  const term = (): Node => {
    let n = unary();
    for (;;) {
      if (peek() && (peek().t === '*' || peek().t === '/')) {
        const op = tokens[p++].t;
        n = { op, a: n, b: unary() };
      } else if (peek() && (peek().t === '(' || peek().t === 'id')) {
        n = { op: '*', a: n, b: unary() };
      } else return n;
    }
  };
  const unary = (): Node => {
    if (eat('-')) return { op: 'neg', a: unary() };
    if (eat('+')) return unary();
    return power();
  };
  const power = (): Node => {
    let n = postfix();
    if (eat('^')) n = { op: '^', a: n, b: unary() };
    return n;
  };
  const postfix = (): Node => {
    let n = atom();
    while (eat('%')) n = { op: '%', a: n };
    return n;
  };
  const atom = (): Node => {
    const t = tokens[p++];
    if (!t) throw new Error('The expression ended too early');
    if (t.t === 'n') return { num: t.v };
    if (t.t === '(') {
      const n = expr();
      if (!eat(')')) throw new Error('Missing )');
      return n;
    }
    if (t.t === 'id') {
      if (t.v === 'pi') return { const: Math.PI };
      if (t.v === 'e' && !(peek() && peek().t === '(')) return { const: Math.E };
      if (!eat('(')) throw new Error(`Unknown name "${t.v}"`);
      const arg = expr();
      if (!eat(')')) throw new Error('Missing )');
      return { fn: t.v, a: arg };
    }
    throw new Error(`Unexpected "${t.t}"`);
  };
  if (!tokens.length) throw new Error('The expression is empty');
  const tree = expr();
  if (p < tokens.length) throw new Error(`Unexpected "${(tokens[p] as { v?: string }).v || tokens[p].t}"`);
  return tree;
}

function evalBig(n: Node): bigint {
  if ('num' in n) {
    if (!/^\d+$/.test(n.num)) throw NOT_EXACT;
    return BigInt(n.num);
  }
  if ('const' in n || 'fn' in n || n.op === '%') throw NOT_EXACT;
  if (n.op === 'neg') return -evalBig(n.a);
  const a = evalBig(n.a);
  const b = evalBig(n.b!);
  if (n.op === '+') return a + b;
  if (n.op === '-') return a - b;
  if (n.op === '*') return a * b;
  if (n.op === '/') {
    if (b === BigInt(0)) throw new Error('Division by zero');
    if (a % b !== BigInt(0)) throw NOT_EXACT;
    return a / b;
  }
  if (
    b < BigInt(0) ||
    b > BigInt(100000) ||
    (a !== BigInt(0) &&
      a !== BigInt(1) &&
      a !== BigInt(-1) &&
      BigInt(a.toString(2).length) * b > BigInt(400000))
  ) {
    throw NOT_EXACT;
  }
  return a ** b;
}

const FN: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  log10: Math.log10,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  exp: Math.exp,
};

function evalNum(n: Node): number {
  if ('num' in n) return parseFloat(n.num);
  if ('const' in n) return n.const;
  if ('fn' in n) {
    const f = FN[n.fn];
    if (!f) throw new Error(`Unknown function "${n.fn}"`);
    return f(evalNum(n.a));
  }
  if (n.op === 'neg') return -evalNum(n.a);
  if (n.op === '%') return evalNum(n.a) / 100;
  const a = evalNum(n.a);
  if ((n.op === '+' || n.op === '-') && n.b && 'op' in n.b && n.b.op === '%') {
    const pc = evalNum(n.b.a) / 100;
    return n.op === '+' ? a * (1 + pc) : a * (1 - pc);
  }
  const b = evalNum(n.b!);
  if (n.op === '/' && b === 0) throw new Error('Division by zero');
  if (n.op === '+') return a + b;
  if (n.op === '-') return a - b;
  if (n.op === '*') return a * b;
  if (n.op === '/') return a / b;
  return Math.pow(a, b);
}

export function calc(s: string): CalcValue {
  const tree = parse(tokenize(s));
  try {
    return evalBig(tree);
  } catch (e) {
    if (e !== NOT_EXACT) throw e;
  }
  const v = evalNum(tree);
  if (!isFinite(v)) throw new Error('The result is not a finite number');
  return v;
}

export function fmtNum(v: CalcValue): string {
  if (typeof v === 'bigint') return v.toString();
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e15) return String(v);
  if (a >= 1e15 || a < 1e-6) return v.toExponential(11).replace(/\.?0+e/, 'e');
  return String(parseFloat(v.toPrecision(12)));
}

export function groupNum(s: string): string {
  if (/e/i.test(s)) return s;
  const neg = s.startsWith('-');
  const rest = neg ? s.slice(1) : s;
  const [i, d] = rest.split('.');
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
}

const UNITS: Record<string, Record<string, number>> = {
  length: {
    mm: 0.001,
    millimetre: 0.001,
    millimeter: 0.001,
    cm: 0.01,
    centimetre: 0.01,
    centimeter: 0.01,
    m: 1,
    metre: 1,
    meter: 1,
    km: 1000,
    kilometre: 1000,
    kilometer: 1000,
    in: 0.0254,
    inch: 0.0254,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    yd: 0.9144,
    yard: 0.9144,
    mi: 1609.344,
    mile: 1609.344,
  },
  force: {
    N: 1,
    newton: 1,
    mN: 1e-3,
    millinewton: 1e-3,
    kN: 1e3,
    kilonewton: 1e3,
    MN: 1e6,
    meganewton: 1e6,
    lbf: 4.4482216152605,
    kip: 4448.2216152605,
    kgf: 9.80665,
    tf: 9806.65,
  },
  pressure: {
    Pa: 1,
    pascal: 1,
    kPa: 1e3,
    MPa: 1e6,
    GPa: 1e9,
    bar: 1e5,
    mbar: 100,
    atm: 101325,
    psi: 6894.757293168,
    ksi: 6894757.293168,
    'N/m2': 1,
    'kN/m2': 1e3,
    'N/mm2': 1e6,
    'kgf/cm2': 98066.5,
    'kg/cm2': 98066.5,
  },
  mass: {
    mg: 1e-6,
    g: 0.001,
    gram: 0.001,
    kg: 1,
    kilogram: 1,
    t: 1000,
    tonne: 1000,
    lb: 0.45359237,
    pound: 0.45359237,
    oz: 0.028349523125,
    ounce: 0.028349523125,
  },
};

const TEMP: Record<string, string> = {
  c: 'C',
  celsius: 'C',
  degc: 'C',
  f: 'F',
  fahrenheit: 'F',
  degf: 'F',
  k: 'K',
  kelvin: 'K',
};

type FoundUnit =
  | { kind: 'temperature'; key: string }
  | { kind: string; key: string; f: number };

function findUnit(raw: unknown): FoundUnit {
  const u0 = String(raw ?? '')
    .trim()
    .replace(/^°\s*/, '')
    .replace(/²|\^2/g, '2')
    .replace(/\s+/g, '');
  if (!u0) throw new Error('A unit is missing.');
  if (TEMP[u0.toLowerCase()]) return { kind: 'temperature', key: TEMP[u0.toLowerCase()] };
  const sing = (u: string) =>
    u
      .replace(/ches$/i, 'ch')
      .replace(/(metre|meter|foot|yard|mile|newton|pascal|gram|tonne|pound|ounce)s$/i, '$1');
  for (const u of [u0, sing(u0)]) {
    for (const [kind, tbl] of Object.entries(UNITS)) {
      if (tbl[u] != null) return { kind, key: u, f: tbl[u] };
    }
    const hits: FoundUnit[] = [];
    for (const [kind, tbl] of Object.entries(UNITS)) {
      for (const k in tbl) {
        if (k.toLowerCase() === u.toLowerCase()) hits.push({ kind, key: k, f: tbl[k] });
      }
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new Error(
        `"${raw}" could mean ${hits.map((h) => h.key).join(' or ')}. Write it with the right capitals.`,
      );
    }
  }
  throw new Error(`Unknown unit "${raw}"`);
}

export function convert(v: unknown, from: unknown, to: unknown): string {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  if (!isFinite(x)) throw new Error(`value must be a number, e.g. 250 (got ${JSON.stringify(v)})`);
  const a = findUnit(from);
  const b = findUnit(to);
  if (a.kind !== b.kind) throw new Error(`Can't convert ${a.kind} (${from}) to ${b.kind} (${to})`);
  if (a.kind === 'temperature') {
    const c = a.key === 'C' ? x : a.key === 'F' ? ((x - 32) * 5) / 9 : x - 273.15;
    const r = b.key === 'C' ? c : b.key === 'F' ? (c * 9) / 5 + 32 : c + 273.15;
    return `${fmtNum(r)} ${to}`;
  }
  return `${fmtNum((x * (a as { f: number }).f) / (b as { f: number }).f)} ${to}`;
}

export type ExactHit = { expr: string; value: CalcValue };

export function exactFor(q: string): ExactHit | null {
  let s = ` ${String(q).replace(/(\d),(?=\d{2,3}\b)/g, '$1')} `;
  s = s
    .replace(/\bmultiplied by\b|\btimes\b/gi, '*')
    .replace(/\bdivided by\b/gi, '/')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\bto the power of\b/gi, '^')
    .replace(/\bsquared\b/gi, '^2')
    .replace(/\bcubed\b/gi, '^3')
    .replace(/(\d)\s*[x×✕·]\s*(?=\d)/g, '$1*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[−–]/g, '-')
    .replace(/(\d(?:\.\d+)?)e([+-]?\d+)\b/gi, '($1*10^($2))');
  const cands: string[] = [];
  for (const m of s.matchAll(/[\d.()+\-*/^%\s]+/g)) {
    const x = m[0]
      .trim()
      .replace(/^[+*/^%)]+|[+\-*/^(]+$/g, '')
      .trim();
    if ((x.match(/\d+(\.\d+)?/g) || []).length < 2 || !/\d\s*[+\-*/^]\s*[\d(]/.test(x)) continue;
    if (/\d-\d/.test(x)) continue;
    const after = s.slice(m.index! + m[0].length).trimStart();
    if (!/[+\-*^]/.test(x.replace(/^-/, '')) && /^[a-z]/i.test(after)) continue;
    cands.push(x);
  }
  cands.sort((a, b) => b.length - a.length);
  for (const c of cands) {
    try {
      return { expr: c, value: calc(c) };
    } catch {
      /* try next */
    }
  }
  return null;
}

const SUP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
};

export function answerMatches(text: string, exact: ExactHit): boolean {
  const t = String(text)
    .replace(/[−–]/g, '-')
    .replace(/(\d)[,  ](?=\d{2,3}\b)/g, '$1')
    .replace(
      /(\d(?:\.\d+)?)\s*[×x*]\s*10\s*(?:\^\s*\(?\s*([+-]?\d+)\s*\)?|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g,
      (_m, a, e1, e2) => `${a}e${e1 ?? [...e2].map((c: string) => SUP[c]).join('')}`,
    );
  const nums = t.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) || [];
  const operands = new Set(String(exact.expr).match(/\d+(?:\.\d+)?/g) || []);
  if (typeof exact.value === 'bigint') {
    const s = exact.value.toString();
    return nums.some((n) => n === s || n.replace(/\.0+$/, '') === s);
  }
  const target = parseFloat(fmtNum(exact.value));
  return nums.some((n) => {
    const x = parseFloat(n);
    if (!isFinite(x)) return false;
    if (operands.has(n) && x !== target) return false;
    if (Number.isInteger(target) && Math.abs(target) < 1e15) return x === target;
    const m = n.match(/^-?\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    const dp = (m && m[1] ? m[1] : '').length;
    const ex = m && m[2] ? +m[2] : 0;
    if (dp - ex < 1 && !Number.isInteger(target)) return false;
    return Math.abs(x - target) <= Math.max(0.5 * 10 ** (ex - dp), Math.abs(target) * 1e-9);
  });
}
