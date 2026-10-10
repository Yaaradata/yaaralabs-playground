/** Student-authored Python tools via Pyodide (client-side). */

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

const PY_OWN = String.raw`
import inspect, json, typing, types, io, re, contextlib
_OWN = {}
_TYPES = {float: "number", int: "integer", str: "string", bool: "boolean", list: "array", dict: "object"}

def _schema_for(ann):
    if ann is inspect.Parameter.empty: return {"type": "string"}, "has no type hint, so the model is told to send text"
    if isinstance(ann, str): return {"type": "string"}, f"has a type hint Python couldn't read ({ann}), so it is sent as text"
    origin = typing.get_origin(ann); args = typing.get_args(ann)
    if origin is typing.Literal:
        vals = list(args); t = _TYPES.get(type(vals[0]), "string") if vals else "string"
        return {"type": t, "enum": vals}, None
    if origin in (typing.Union, getattr(types, "UnionType", ())):
        rest = [a for a in args if a is not type(None)]
        if rest: return _schema_for(rest[0])
    if origin in (list, typing.List) or ann is list:
        return {"type": "array", "items": _schema_for(args[0])[0] if args else {"type": "string"}}, None
    if origin in (dict, typing.Dict) or ann is dict: return {"type": "object"}, None
    if ann in _TYPES: return {"type": _TYPES[ann]}, None
    return {"type": "string"}, f"is a {getattr(ann, '__name__', ann)}, which is sent as text"

def _parse_doc(doc):
    lines = doc.split("\n"); main, params, sect, cur, numpy, entry = [], {}, None, None, False, None
    for k, ln in enumerate(lines):
        s = ln.strip(); ind = len(ln) - len(ln.lstrip())
        nxt = lines[k + 1].strip() if k + 1 < len(lines) else ""
        if re.match(r"^(Args|Arguments|Parameters|Params)\s*:?$", s):
            sect = "args"; numpy = bool(re.match(r"^-{3,}$", nxt)); entry = None; cur = None; continue
        if re.match(r"^(Returns?|Raises|Yields?|Examples?|Notes?|See Also)\s*:?$", s): sect = "other"; continue
        if re.match(r"^-{3,}$", s): continue
        if sect == "args":
            m = re.match(r"^(\w+)\s*(\([^)]*\))?\s*:\s*(.*)$", s)
            if m and (entry is None or ind <= entry):
                if entry is None: entry = ind
                cur = m.group(1); params[cur] = "" if numpy else m.group(3); continue
            if s and cur: params[cur] = (params[cur] + " " + s).strip()
        elif sect is None: main.append(ln)
    text = "\n".join(main).strip()
    return re.sub(r"(?<!\n)\n(?!\n)", " ", text), params

def _pg_define(src, taken):
    ns = {"__name__": "your_tools"}
    exec(compile(src, "<your tool>", "exec"), ns)
    found, notes = [], []
    for name, fn in list(ns.items()):
        if name.startswith("_") or not inspect.isfunction(fn) or fn.__globals__ is not ns: continue
        if name in taken:
            notes.append(f"{name}: a built-in tool already has this name. Rename your function."); continue
        desc, pdocs = _parse_doc(inspect.getdoc(fn) or "")
        try: sig = inspect.signature(fn, eval_str=True)
        except Exception: sig = inspect.signature(fn)
        props, req = {}, []
        for pn, prm in sig.parameters.items():
            if prm.kind in (prm.VAR_POSITIONAL, prm.VAR_KEYWORD): continue
            sch, warn = _schema_for(prm.annotation)
            if pdocs.get(pn): sch["description"] = pdocs[pn]
            if prm.default is inspect.Parameter.empty: req.append(pn)
            elif isinstance(prm.default, (int, float, str, bool)): sch["default"] = prm.default
            props[pn] = sch
            if warn: notes.append(f"{name}: {pn} {warn}.")
        if not desc: notes.append(f"{name}: no docstring, so the model gets no description of what it does.")
        found.append({"name": name, "desc": desc, "schema": {"type": "object", "properties": props, "required": req}})
    if not found and not notes: notes.append("No function found. Write one with def, like the example.")
    _OWN.clear(); _OWN.update({f["name"]: ns[f["name"]] for f in found})
    return json.dumps({"tools": found, "notes": notes})

def _pg_call(name, args_json):
    fn = _OWN[name]; args = json.loads(args_json)
    try: sig = inspect.signature(fn, eval_str=True)
    except Exception: sig = inspect.signature(fn)
    for k, v in list(args.items()):
        p = sig.parameters.get(k)
        if p is None: raise TypeError(f"{name}() got an unexpected argument '{k}'")
        ann = p.annotation
        if typing.get_origin(ann) in (typing.Union, getattr(types, "UnionType", ())):
            rest = [a for a in typing.get_args(ann) if a is not type(None)]; ann = rest[0] if rest else ann
        try:
            if ann is float and isinstance(v, (int, str)) and not isinstance(v, bool): args[k] = float(str(v).replace(",", ""))
            elif ann is int and isinstance(v, (float, str)) and float(str(v).replace(",", "")).is_integer(): args[k] = int(float(str(v).replace(",", "")))
        except ValueError: pass
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf): r = fn(**args)
    out = r if isinstance(r, str) else json.dumps(r) if isinstance(r, (dict, list)) else repr(r)
    return buf.getvalue() + out
`;

type PyodideLike = {
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (name: string) => (a: string, b: string) => string };
};

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
  }
}

let pyReady: Promise<PyodideLike> | null = null;

export function ensurePython(): Promise<PyodideLike> {
  if (pyReady) return pyReady;
  pyReady = (async () => {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = `${PYODIDE_URL}pyodide.js`;
      s.onload = () => res();
      s.onerror = () =>
        rej(new Error("Python couldn't load. Check the internet connection, then try again."));
      document.head.appendChild(s);
    });
    if (!window.loadPyodide) throw new Error("Python couldn't load.");
    const py = await window.loadPyodide({ indexURL: PYODIDE_URL });
    await py.runPythonAsync(PY_OWN);
    return py;
  })();
  pyReady.catch(() => {
    pyReady = null;
  });
  return pyReady;
}

export function pyErr(e: unknown): string {
  const m = String((e as { message?: string })?.message || e);
  const lines = m.trim().split('\n').filter(Boolean);
  const line = [...m.matchAll(/File "<your tool>", line (\d+)/g)].pop();
  return (line ? `Line ${line[1]}: ` : '') + (lines[lines.length - 1] || m);
}

export async function callOwn(name: string, input: Record<string, unknown>): Promise<string> {
  const py = await ensurePython();
  try {
    return py.globals.get('_pg_call')(name, JSON.stringify(input || {}));
  } catch (e) {
    throw new Error(pyErr(e));
  }
}

export type DefinedOwnTool = {
  name: string;
  desc: string;
  schema: { type: string; properties: Record<string, unknown>; required: string[] };
};

export async function defineOwn(
  code: string,
  takenNames: string[],
): Promise<{ tools: DefinedOwnTool[]; notes: string[] }> {
  const py = await ensurePython();
  const raw = py.globals.get('_pg_define')(code, takenNames as unknown as string);
  return JSON.parse(String(raw)) as { tools: DefinedOwnTool[]; notes: string[] };
}

/** Syntax highlight a Python snippet for the overlay editor. */
export function hlPython(src: string, esc: (s: string) => string): string {
  const PY_KW = new Set(
    'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
      ' ',
    ),
  );
  const PY_BI = new Set(
    'print len range int float str list dict set tuple bool abs min max sum round sorted enumerate zip map filter isinstance type repr any all'.split(
      ' ',
    ),
  );
  const TOK =
    /(#[^\n]*)|([rbfuRBFU]{0,2}(?:"""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S]))|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)/g;
  let out = '';
  let last = 0;
  let prev = '';
  src.replace(TOK, (m, com, str, num, dec, id, i: number) => {
    out += esc(src.slice(last, i));
    last = i + m.length;
    const cls = com
      ? 'k-com'
      : str
        ? 'k-str'
        : num
          ? 'k-num'
          : dec
            ? 'k-dec'
            : PY_KW.has(id)
              ? 'k-kw'
              : prev === 'def' || prev === 'class'
                ? 'k-fn'
                : PY_BI.has(id) && src[i + m.length] === '('
                  ? 'k-bi'
                  : '';
    out += cls ? `<span class="${cls}">${esc(m)}</span>` : esc(m);
    prev = id || '';
    return m;
  });
  return out + esc(src.slice(last));
}
