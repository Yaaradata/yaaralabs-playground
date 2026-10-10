var CAT = {
    model:     { fill: "#CF63CF", line: "#C94FC9", dot: "#CF63CF", name: "Model" },
    events:    { fill: "#C88330", line: "#A96C22", dot: "#C88330", name: "Events" },
    control:   { fill: "#E1A91A", line: "#B88B12", dot: "#E1A91A", name: "Control" },
    data:      { fill: "#EE7D16", line: "#C56410", dot: "#EE7D16", name: "Variables" },
    lists:     { fill: "#CC5B22", line: "#A84818", dot: "#CC5B22", name: "Lists" },
    sensing:   { fill: "#2CA5E2", line: "#2189BD", dot: "#2CA5E2", name: "Sensing" },
    looks:     { fill: "#9966FF", line: "#7A4FD6", dot: "#9966FF", name: "Looks" },
    operators: { fill: "#5CB712", line: "#47900D", dot: "#5CB712", name: "Operators" },
  };

  var KEYS = [
    "space", "enter", "up arrow", "down arrow", "left arrow", "right arrow", "any",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ];

  // part helpers ------------------------------------------------------------
  function L(v) { return { t: "lbl", v: v }; }
  function N(n, d) { return { t: "in", n: n, k: "num", d: d == null ? "" : String(d) }; }
  function T(n, d) { return { t: "in", n: n, k: "txt", d: d == null ? "" : String(d) }; }
  function B(n) { return { t: "in", n: n, k: "bool" }; }
  function V(n) { return { t: "fld", n: n || "VAR", src: "vars" }; }

  // shape: hat | stack | cap | c | c2 | rep | bool
  var SPEC = {
    when_flag:  { cat: "events", shape: "hat", parts: [{ t: "icon", flag: "green" }, L("Start")] },
    end_script: { cat: "events", shape: "cap", parts: [{ t: "icon", flag: "red" }, L("End")] },
    when_key:   { cat: "events", shape: "hat",
                  parts: [L("when"), { t: "fld", n: "KEY", opts: KEYS }, L("key pressed")] },
    when_recv:  { cat: "events", shape: "hat", parts: [L("when I receive"), T("MSG", "go")] },
    broadcast:  { cat: "events", shape: "stack", parts: [L("broadcast"), T("MSG", "go")] },
    broadcast_w:{ cat: "events", shape: "stack", parts: [L("broadcast"), T("MSG", "go"), L("and wait")] },

    ask_model:  { cat: "model", shape: "stack",
                  parts: [L("ask the model about"), T("PROMPT", "What should I send to the model?")] },
    prediction: { cat: "model", shape: "rep", parts: [L("prediction")] },

    ask:        { cat: "sensing", shape: "stack", parts: [L("ask"), T("Q", "What is your name?"), L("and wait")] },
    answer:     { cat: "sensing", shape: "rep", parts: [L("answer")] },
    answer_empty:{ cat: "sensing", shape: "bool", parts: [L("answer is empty?")] },
    set_answer: { cat: "sensing", shape: "stack", parts: [L("set answer to"), T("VAL", "")] },
    key_down:   { cat: "sensing", shape: "bool",
                  parts: [L("key"), { t: "fld", n: "KEY", opts: KEYS }, L("pressed?")] },
    timer:      { cat: "sensing", shape: "rep", parts: [L("timer")] },
    reset_timer:{ cat: "sensing", shape: "stack", parts: [L("reset timer")] },
    current:    { cat: "sensing", shape: "rep",
                  parts: [L("current"), { t: "fld", n: "UNIT",
                          opts: ["year", "month", "date", "day of week", "hour", "minute", "second"] }] },

    set_var:    { cat: "data", shape: "stack", parts: [L("set"), V(), L("to"), T("VAL", "0")] },
    change_var: { cat: "data", shape: "stack", parts: [L("change"), V(), L("by"), N("BY", 1)] },
    show_var:   { cat: "data", shape: "stack", parts: [L("show variable"), V()] },
    hide_var:   { cat: "data", shape: "stack", parts: [L("hide variable"), V()] },
    var_get:    { cat: "data", shape: "rep", parts: [V()], hidden: true },

    say:        { cat: "looks", shape: "stack", parts: [L("say"), T("MSG", "Hello!")] },
    say_secs:   { cat: "looks", shape: "stack", parts: [L("say"), T("MSG", "Hello!"), L("for"), N("SECS", 2), L("secs")] },
    think:      { cat: "looks", shape: "stack", parts: [L("think"), T("MSG", "Hmm…")] },
    think_secs: { cat: "looks", shape: "stack", parts: [L("think"), T("MSG", "Hmm…"), L("for"), N("SECS", 2), L("secs")] },
    clear_out:  { cat: "looks", shape: "stack", parts: [L("clear output")] },

    wait:       { cat: "control", shape: "stack", parts: [L("wait"), N("SECS", 1), L("seconds")] },
    wait_until: { cat: "control", shape: "stack", parts: [L("wait until"), B("COND")] },
    repeat:     { cat: "control", shape: "c", parts: [L("repeat"), N("N", 10)] },
    repeat_until:{cat: "control", shape: "c", parts: [L("repeat until"), B("COND")] },
    forever:    { cat: "control", shape: "c", noBottom: true, parts: [L("forever")] },
    if_then:    { cat: "control", shape: "c", parts: [L("if"), B("COND"), L("then")] },
    if_else:    { cat: "control", shape: "c2", parts: [L("if"), B("COND"), L("then")], parts2: [L("else")] },
    stop_all:   { cat: "control", shape: "cap",
                  parts: [{ t: "icon", flag: "red" }, L("Stop"), { t: "fld", n: "WHAT", opts: ["this script", "everything"] }] },
    break_loop: { cat: "control", shape: "cap", parts: [L("break")] },
    continue_loop:{ cat: "control", shape: "cap", parts: [L("continue")] },
    for_each:   { cat: "control", shape: "c",
                  parts: [L("for each"), V("VAR"), L("in"), T("LIST", "")] },
    note:       { cat: "control", shape: "stack", parts: [L("note"), T("MSG", "write a reminder")] },

    list_add:   { cat: "lists", shape: "stack", parts: [L("add"), T("ITEM", "thing"), L("to"), V("LIST")] },
    list_delete_all:{ cat: "lists", shape: "stack", parts: [L("delete all of"), V("LIST")] },
    list_delete:{ cat: "lists", shape: "stack",
                  parts: [L("delete"), N("INDEX", 0), L("of"), V("LIST")] },
    list_insert:{ cat: "lists", shape: "stack",
                  parts: [L("insert"), T("ITEM", "thing"), L("at"), N("INDEX", 0), L("of"), V("LIST")] },
    list_replace:{ cat: "lists", shape: "stack",
                  parts: [L("replace"), N("INDEX", 0), L("of"), V("LIST"), L("with"), T("ITEM", "thing")] },
    list_item:  { cat: "lists", shape: "rep",
                  parts: [L("item"), N("INDEX", 0), L("of"), V("LIST")] },
    list_length:{ cat: "lists", shape: "rep", parts: [L("length of"), V("LIST")] },
    list_contains:{ cat: "lists", shape: "bool",
                  parts: [V("LIST"), L("contains"), T("ITEM", "thing")] },
    list_make:  { cat: "lists", shape: "rep", parts: [L("list")], hidden: true },

    op_add:     { cat: "operators", shape: "rep", parts: [N("A", ""), L("+"), N("B", "")] },
    op_sub:     { cat: "operators", shape: "rep", parts: [N("A", ""), L("\u2212"), N("B", "")] },
    op_mul:     { cat: "operators", shape: "rep", parts: [N("A", ""), L("\u00D7"), N("B", "")] },
    op_div:     { cat: "operators", shape: "rep", parts: [N("A", ""), L("/"), N("B", "")] },
    op_mod:     { cat: "operators", shape: "rep", parts: [N("A", ""), L("mod"), N("B", "")] },
    op_random:  { cat: "operators", shape: "rep", parts: [L("pick random"), N("A", 1), L("to"), N("B", 10)] },
    op_math:    { cat: "operators", shape: "rep",
                  parts: [{ t: "fld", n: "FN", opts: ["abs", "floor", "ceiling", "sqrt"] }, L("of"), N("A", 9)] },
    op_min:     { cat: "operators", shape: "rep", parts: [L("min"), N("A", 1), L("and"), N("B", 10)] },
    op_max:     { cat: "operators", shape: "rep", parts: [L("max"), N("A", 1), L("and"), N("B", 10)] },
    op_letter:  { cat: "operators", shape: "rep", parts: [L("letter"), N("A", 1), L("of"), T("B", "world")] },
    op_length:  { cat: "operators", shape: "rep", parts: [L("length of"), T("A", "world")] },
    op_round:   { cat: "operators", shape: "rep", parts: [L("round"), N("A", "")] },
    op_join:    { cat: "operators", shape: "rep", parts: [L("join"), T("A", "hello "), T("B", "world")] },
    op_num:     { cat: "operators", shape: "rep", parts: [L("number of"), T("A", "42")] },
    op_lt:      { cat: "operators", shape: "bool", parts: [T("A", ""), L("<"), T("B", "50")] },
    op_eq:      { cat: "operators", shape: "bool", parts: [T("A", ""), L("="), T("B", "50")] },
    op_gt:      { cat: "operators", shape: "bool", parts: [T("A", ""), L(">"), T("B", "50")] },
    op_le:      { cat: "operators", shape: "bool", parts: [T("A", ""), L("\u2264"), T("B", "50")] },
    op_ge:      { cat: "operators", shape: "bool", parts: [T("A", ""), L("\u2265"), T("B", "50")] },
    op_ne:      { cat: "operators", shape: "bool", parts: [T("A", ""), L("\u2260"), T("B", "50")] },
    op_and:     { cat: "operators", shape: "bool", parts: [B("A"), L("and"), B("B")] },
    op_or:      { cat: "operators", shape: "bool", parts: [B("A"), L("or"), B("B")] },
    op_not:     { cat: "operators", shape: "bool", parts: [L("not"), B("A")] },
    op_true:    { cat: "operators", shape: "bool", parts: [L("true")] },
    op_false:   { cat: "operators", shape: "bool", parts: [L("false")] },
    op_contains:{ cat: "operators", shape: "bool", parts: [T("A", "apple"), L("contains"), T("B", "a")] },
    op_startswith:{ cat: "operators", shape: "bool", parts: [T("A", "hello"), L("starts with"), T("B", "he")] },
    op_endswith:{ cat: "operators", shape: "bool", parts: [T("A", "hello"), L("ends with"), T("B", "lo")] },
    op_if:      { cat: "operators", shape: "rep",
                  parts: [L("if"), B("COND"), L("then"), T("A", "1"), L("else"), T("B", "0")] },
  };

  // palette order per category
  // Strings starting with "#" are section headers (not blocks) — used by buildPalette.
  var PALETTE = {
    // Model first — ask an LLM and read its prediction
    model: [
      "#Ask", "ask_model",
      "#Result", "prediction",
    ],
    // Teaching path: Start first, then End, then keyboard / messages
    events: [
      "#Start", "when_flag",
      "#End", "end_script",
      "#Keyboard", "when_key",
      "#Messages", "when_recv", "broadcast", "broadcast_w",
    ],
    // Decisions first — students looking for if should not scroll past waits/loops
    control: [
      "#Decisions", "if_then", "if_else",
      "#Loops", "repeat", "repeat_until", "forever", "for_each",
      "#Timing", "wait", "wait_until",
      "#Stop", "stop_all", "break_loop", "continue_loop",
      "#Notes", "note",
    ],
    data: [
      "#Change", "set_var", "change_var",
      "#Show or hide", "show_var", "hide_var",
    ],
    lists: [
      "#Change", "list_add", "list_insert", "list_replace", "list_delete", "list_delete_all",
      "#Look up", "list_item", "list_length", "list_contains",
    ],
    sensing: [
      "#Ask", "ask", "answer", "answer_empty", "set_answer",
      "#Keys", "key_down",
      "#Time", "timer", "reset_timer", "current",
    ],
    looks: [
      "#Say", "say", "say_secs",
      "#Think", "think", "think_secs",
      "#Clear", "clear_out",
    ],
    // Teaching path: Compare/Logic first so if-slots are easy to fill without scrolling past math
    operators: [
      "#Compare", "op_eq", "op_ne", "op_gt", "op_ge", "op_lt", "op_le",
      "#Logic", "op_and", "op_or", "op_not", "op_true", "op_false",
      "#Text", "op_join", "op_letter", "op_length", "op_contains", "op_startswith", "op_endswith", "op_if",
      "#Math", "op_add", "op_sub", "op_mul", "op_div", "op_mod", "op_random", "op_math",
              "op_min", "op_max", "op_round", "op_num",
    ],
  };

  var seq = 0;
  function uid() { return "b" + (++seq); }

  function make(op, opts) {
    opts = opts || {};
    var s = SPEC[op];
    if (!s) throw new Error("unknown block " + op);
    var b = { id: uid(), op: op, fields: {}, inputs: {}, body: [], body2: [], items: null };
    allParts(s).forEach(function (p) {
      if (p.t === "fld")
        b.fields[p.n] = opts.f && opts.f[p.n] != null ? opts.f[p.n] : (p.opts ? p.opts[0] : "");
      if (p.t === "in") b.inputs[p.n] = opts.i && opts.i[p.n] != null ? opts.i[p.n] : (p.k === "bool" ? null : p.d);
    });
    if (opts.body) b.body = opts.body;
    if (opts.body2) b.body2 = opts.body2;
    if (opts.items) b.items = opts.items.slice();
    return b;
  }
  function allParts(s) { return (s.parts || []).concat(s.parts2 || []); }

  function clone(b) {
    var c = { id: uid(), op: b.op, fields: {}, inputs: {}, body: [], body2: [], items: null };
    Object.keys(b.fields).forEach(function (k) { c.fields[k] = b.fields[k]; });
    Object.keys(b.inputs).forEach(function (k) {
      var v = b.inputs[k];
      c.inputs[k] = (v && typeof v === "object") ? clone(v) : v;
    });
    c.body = b.body.map(clone);
    c.body2 = b.body2.map(clone);
    if (b.items) {
      c.items = b.items.map(function (v) {
        return (v && typeof v === "object" && v.op) ? clone(v) : v;
      });
    }
    return c;
  }
  function cloneList(l) { return l.map(clone); }

  function isStackShape(op) {
    var sh = SPEC[op].shape;
    return sh === "stack" || sh === "hat" || sh === "c" || sh === "c2" || sh === "cap";
  }

  // ---------------------------------------------------------------- geometry
  var G = { r: 4, nx: 12, nd: 5, arm: 16, hat: 22 };

  function notchDown(x) { // travelling left to right along a top edge
    return "L " + x + ",0 L " + (x + 4) + "," + G.nd + " L " + (x + 14) + "," + G.nd + " L " + (x + 18) + ",0 ";
  }
  function bumpAt(y, w) { // travelling right to left along a bottom edge
    return "L 30," + y + " L 26," + (y + G.nd) + " L 16," + (y + G.nd) + " L 12," + y + " ";
  }
  function innerNotch(y) { // underside of a C top bar, travelling right to left
    var a = G.arm;
    return "L " + (a + 30) + "," + y + " L " + (a + 26) + "," + (y + G.nd) +
           " L " + (a + 16) + "," + (y + G.nd) + " L " + (a + 12) + "," + y + " ";
  }

  function pathStack(w, h, opt) {
    var r = G.r, d = "M 0," + r + " Q 0,0 " + r + ",0 ";
    d += notchDown(G.nx);
    d += "L " + (w - r) + ",0 Q " + w + ",0 " + w + "," + r + " ";
    d += "L " + w + "," + (h - r) + " Q " + w + "," + h + " " + (w - r) + "," + h + " ";
    if (!opt || !opt.noBump) d += bumpAt(h, w);
    d += "L " + r + "," + h + " Q 0," + h + " 0," + (h - r) + " Z";
    return d;
  }
  function pathHat(w, h) {
    // left shoulder rises in a curve then the top edge runs flat, as in Scratch 2
    var r = G.r, t = G.hat, dw = 46;
    var d = "M 0," + t + " C 0," + (t * 0.35).toFixed(1) + " " + (dw * 0.42).toFixed(1) + ",0 " + dw + ",0 ";
    d += "L " + (w - r) + ",0 Q " + w + ",0 " + w + "," + r + " ";
    d += "L " + w + "," + (h - r) + " Q " + w + "," + h + " " + (w - r) + "," + h + " ";
    d += bumpAt(h, w);
    d += "L " + r + "," + h + " Q 0," + h + " 0," + (h - r) + " L 0," + t + " Z";
    return d;
  }
  // segs: [{t:'row',h},{t:'mouth',h},...] always ends with a row (the foot)
  function pathC(w, segs, noBump) {
    var r = G.r, a = G.arm;
    var d = "M 0," + r + " Q 0,0 " + r + ",0 ";
    d += notchDown(G.nx);
    d += "L " + (w - r) + ",0 Q " + w + ",0 " + w + "," + r + " ";
    var y = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], last = i === segs.length - 1;
      y += s.h;
      if (s.t === "row") {
        if (last) {
          d += "L " + w + "," + (y - r) + " Q " + w + "," + y + " " + (w - r) + "," + y + " ";
          if (!noBump) d += bumpAt(y, w);
          d += "L " + r + "," + y + " Q 0," + y + " 0," + (y - r) + " Z";
        } else {
          d += "L " + w + "," + y + " " + innerNotch(y) + "L " + a + "," + y + " ";
        }
      } else {
        d += "L " + a + "," + y + " L " + w + "," + y + " ";
      }
    }
    return d;
  }
  function pathRep(w, h) {
    var r = h / 2;
    return "M " + r + ",0 L " + (w - r) + ",0 A " + r + "," + r + " 0 0 1 " + (w - r) + "," + h +
           " L " + r + "," + h + " A " + r + "," + r + " 0 0 1 " + r + ",0 Z";
  }
  function pathBool(w, h) {
    var p = h / 2;
    return "M " + p + ",0 L " + (w - p) + ",0 L " + w + "," + (h / 2) + " L " + (w - p) + "," + h +
           " L " + p + "," + h + " L 0," + (h / 2) + " Z";
  }

  // ---------------------------------------------------------------- render
  var SVGNS = "http://www.w3.org/2000/svg";
  var measurer = null;
  function textWidth(s, font) {
    if (!measurer) measurer = document.createElement("canvas").getContext("2d");
    measurer.font = font || "600 12px 'Helvetica Neue',Helvetica,Arial,sans-serif";
    return measurer.measureText(s || "").width;
  }
  function sizeField(inp) {
    var w = textWidth(inp.value || inp.placeholder || "", "600 12px 'Helvetica Neue',Helvetica,Arial,sans-serif");
    inp.style.width = Math.max(inp.classList.contains("txt") ? 34 : 26, Math.ceil(w) + 18) + "px";
  }

  var FLAG_GREEN = '<svg class="icon-flag" viewBox="0 0 16 16"><path d="M3 1v14" stroke="#3B7A2F" stroke-width="2" ' +
             'stroke-linecap="round" fill="none"/><path d="M4.5 2.2c3-1.6 5 1.6 8 0v6.4c-3 1.6-5-1.6-8 0z" ' +
             'fill="#4CBB47" stroke="#3B7A2F" stroke-width="1"/></svg>';
  var FLAG_RED = '<svg class="icon-flag" viewBox="0 0 16 16"><path d="M3 1v14" stroke="#8B2E24" stroke-width="2" ' +
             'stroke-linecap="round" fill="none"/><path d="M4.5 2.2c3-1.6 5 1.6 8 0v6.4c-3 1.6-5-1.6-8 0z" ' +
             'fill="#EF6F5E" stroke="#8B2E24" stroke-width="1"/></svg>';

  // ctx: { vars:[names], editable:bool }
  function renderBlock(b, ctx) {
    var s = SPEC[b.op], c = CAT[s.cat];
    var el = document.createElement("div");
    el.className = "blk s-" + s.shape + " c-" + s.cat;
    el.dataset.id = b.id;
    el.dataset.op = b.op;

    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "fr");
    var path = document.createElementNS(SVGNS, "path");
    path.setAttribute("fill", c.fill);
    path.setAttribute("stroke", c.line);
    path.setAttribute("stroke-width", "1");
    svg.appendChild(path);
    el.appendChild(svg);

    el.appendChild(renderRow(b, s.parts, ctx));
    if (s.shape === "c" || s.shape === "c2") {
      el.appendChild(renderMouth(b, "body", ctx));
      if (s.shape === "c2") {
        el.appendChild(renderRow(b, s.parts2, ctx));
        el.appendChild(renderMouth(b, "body2", ctx));
      }
      var ft = document.createElement("div");
      ft.className = "ft";
      el.appendChild(ft);
    }
    return el;
  }

  function renderRow(b, parts, ctx) {
    var row = document.createElement("div");
    row.className = "rw";
    (parts || []).forEach(function (p) {
      if (p.t === "lbl") {
        var sp = document.createElement("span");
        sp.textContent = p.v;
        row.appendChild(sp);
      } else if (p.t === "icon") {
        var w = document.createElement("span");
        w.innerHTML = p.flag === "red" ? FLAG_RED : FLAG_GREEN;
        row.appendChild(w);
      } else if (p.t === "fld") {
        row.appendChild(renderField(b, p, ctx));
      } else {
        row.appendChild(renderSlot(b, p, ctx));
      }
    });
    return row;
  }

  function renderField(b, p, ctx) {
    var sel = document.createElement("select");
    sel.className = "dd";
    sel.dataset.field = p.n;
    sel.dataset.owner = b.id;
    var opts = p.src === "vars" ? (ctx.vars.length ? ctx.vars : ["(no variables)"]) : p.opts;
    var cur = b.fields[p.n];
    if (cur && opts.indexOf(cur) < 0) opts = opts.concat([cur]);
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o; op.textContent = o;
      op.style.color = "#010101";
      op.style.backgroundColor = "#ffffff";
      if (o === cur) op.selected = true;
      sel.appendChild(op);
    });
    if (!cur && opts.length) b.fields[p.n] = opts[0];
    return sel;
  }

  function renderSlot(b, p, ctx) {
    var v = b.inputs[p.n];
    var wrap = document.createElement("span");
    wrap.className = "slot";
    wrap.dataset.slot = p.n;
    wrap.dataset.kind = p.k;
    wrap.dataset.owner = b.id;
    if (v && typeof v === "object") {
      wrap.appendChild(renderBlock(v, ctx));
      return wrap;
    }
    if (p.k === "bool") {
      wrap.classList.add("empty-bool");
      return wrap;
    }
    var inp = document.createElement("input");
    inp.className = "fld" + (p.k === "txt" ? " txt" : "");
    inp.value = v == null ? "" : v;
    inp.placeholder = p.k === "num" ? "" : "";
    inp.dataset.input = p.n;
    inp.dataset.owner = b.id;
    if (!ctx.editable) inp.readOnly = true;
    wrap.appendChild(inp);
    return wrap;
  }

  // second pass: size inputs, then draw every frame from the measured layout
  function paint(root) {
    var inputs = root.querySelectorAll("input.fld");
    for (var i = 0; i < inputs.length; i++) sizeField(inputs[i]);
    var blks = root.querySelectorAll(".blk");
    for (var j = 0; j < blks.length; j++) drawFrame(blks[j]);
  }

  function drawFrame(el) {
    var op = el.dataset.op, s = SPEC[op];
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    var svg = el.querySelector(":scope > .fr"), path = svg.querySelector("path"), d;

    if (s.shape === "hat") d = pathHat(w, h);
    else if (s.shape === "rep") d = pathRep(w, h);
    else if (s.shape === "bool") d = pathBool(w, h);
    else if (s.shape === "c" || s.shape === "c2") {
      var segs = [], kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.classList.contains("rw")) segs.push({ t: "row", h: k.offsetHeight });
        else if (k.classList.contains("mo")) segs.push({ t: "mouth", h: k.offsetHeight });
        else if (k.classList.contains("ft")) segs.push({ t: "row", h: k.offsetHeight });
      }
      d = pathC(w, segs, !!s.noBottom);
    } else d = pathStack(w, h, { noBump: s.shape === "cap" });

    path.setAttribute("d", d);
    svg.setAttribute("width", w + 2);
    svg.setAttribute("height", h + 8);
  }

  function renderMouth(b, key, ctx) {
    var mo = document.createElement("div");
    mo.className = "mo";
    mo.dataset.body = key;
    mo.dataset.owner = b.id;
    b[key].forEach(function (child) { mo.appendChild(renderBlock(child, ctx)); });
    return mo;
  }

  function renderStack(list, ctx) {
    var d = document.createElement("div");
    d.className = "stk";
    list.forEach(function (b) { d.appendChild(renderBlock(b, ctx)); });
    return d;
  }

const BL = {
    CAT: CAT, SPEC: SPEC, PALETTE: PALETTE,
    make: make, clone: clone, cloneList: cloneList, isStackShape: isStackShape, allParts: allParts,
    renderBlock: renderBlock, renderStack: renderStack, paint: paint, sizeField: sizeField,
  };
export default BL;
