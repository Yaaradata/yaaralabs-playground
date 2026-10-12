import BL from './blocks.js';

/**
 * Mount Rule Based Process into `root` (must contain the prototype DOM).
 * @param {HTMLElement} root
 * @param {{ initialState?: object, onSave?: (state: object) => void, askModel?: (prompt: string) => Promise<string>, onReset?: () => Promise<object|null|undefined> } | undefined} options
 * @returns {{ cleanup: () => void, getState: () => object, applyState: (state: object) => void }}
 */
export function mountRuleBasedProcess(root, options) {
  options = options || {};
  var toolbarHost = options.toolbarHost || null;
  var $ = function (s) {
    return root.querySelector(s) || (toolbarHost ? toolbarHost.querySelector(s) : null);
  };
    var $$ = function (s) {
      var a = Array.prototype.slice.call(root.querySelectorAll(s));
      if (toolbarHost) a = a.concat(Array.prototype.slice.call(toolbarHost.querySelectorAll(s)));
      return a;
    };
    var cleanups = [];
    function on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      cleanups.push(function () { target.removeEventListener(type, handler, opts); });
    }
    var mk = function (op, o) { return BL.make(op, o); };
    var V = function (n) { return mk("var_get", { f: { VAR: n } }); };

    // Machine Learning mode (Text Recognition "Use the AI"): options.ml = { trained, labels, recognise }.
    // The Machine Learning blocks appear only once the model is trained; the LLM "Model" preset and
    // tab are left out because this page has no language model behind it.
    var ML = options.ml || null;
    var mlImage = !!(ML && ML.kind === "image");
    var mlReady = !!(ML && ML.trained && ML.labels && ML.labels.length &&
      typeof (mlImage ? ML.recogniseImage : ML.recognise) === "function");
    var mlLabels = mlReady ? ML.labels.map(String) : [];
    function hiddenCat(cat) {
      if (cat === "ml") return !mlReady;
      if (cat === "model") return !!ML;
      return false;
    }
  
    // ------------------------------------------------------------------ concepts
    function grade() {
      function band(lo, hi, g) {
        var cond = hi == null
          ? mk("op_lt", { i: { A: V("Marks"), B: String(lo) } })
          : mk("op_and", { i: {
              A: mk("op_gt", { i: { A: V("Marks"), B: String(lo - 1) } }),
              B: mk("op_lt", { i: { A: V("Marks"), B: String(hi + 1) } }) } });
        return mk("if_then", { i: { COND: cond },
          body: [mk("set_var", { f: { VAR: "Grade" }, i: { VAL: g } })] });
      }
      return [
        mk("when_flag"),
        mk("ask", { i: { Q: "Enter the marks" } }),
        mk("set_var", { f: { VAR: "Marks" }, i: { VAL: mk("answer") } }),
        band(33, null, "E"), band(33, 40, "D"), band(41, 60, "C"),
        band(61, 80, "B"), band(81, 100, "A"),
        mk("say_secs", { i: {
          MSG: mk("op_join", { i: { A: "Your grade is ", B: V("Grade") } }), SECS: "2" } }),
      ];
    }
  
    var PRESETS = [
      {
        id: "grade", title: "Marks to grade",
        vars: ["Marks", "Grade"],
        answer: { type: "int", min: 0, max: 100, noun: "the marks" },
        brief: "Ask the student for their marks, work out the grade, then say it.\n\n" +
               "below 33 \u2192 E\n33 to 40 \u2192 D\n41 to 60 \u2192 C\n61 to 80 \u2192 B\n81 to 100 \u2192 A\n\n" +
               "Say the answer as: Your grade is C",
        tests: [],
        solution: grade,
      },
      {
        id: "oddeven", title: "Odd or even",
        vars: ["Number"],
        answer: { type: "int", noun: "a whole number" },
        brief: "Ask for a whole number. Say Odd or Even.\n\n" +
               "Hint: a number is even when the remainder after dividing by 2 is 0.\n" +
               "The mod block gives you that remainder.",
        tests: [],
        solution: function () {
          return [
            mk("when_flag"),
            mk("ask", { i: { Q: "Enter a number" } }),
            mk("set_var", { f: { VAR: "Number" }, i: { VAL: mk("answer") } }),
            mk("if_else", {
              i: { COND: mk("op_eq", { i: { A: mk("op_mod", { i: { A: V("Number"), B: "2" } }), B: "0" } }) },
              body: [mk("say", { i: { MSG: "Even" } })],
              body2: [mk("say", { i: { MSG: "Odd" } })],
            }),
          ];
        },
      },
      {
        id: "leap", title: "Leap year",
        vars: ["Year"],
        answer: { type: "int", min: 1, max: 3000, noun: "a year" },
        brief: "Ask for a year and say whether it is a leap year.\n\n" +
               "A year is a leap year when it divides by 4,\n" +
               "except years that divide by 100,\n" +
               "unless they also divide by 400.\n\n" +
               "Say: Leap year  or  Not a leap year",
        tests: [],
        solution: function () {
          var div = function (n) { return mk("op_eq", { i: { A: mk("op_mod", { i: { A: V("Year"), B: String(n) } }), B: "0" } }); };
          return [
            mk("when_flag"),
            mk("ask", { i: { Q: "Enter a year" } }),
            mk("set_var", { f: { VAR: "Year" }, i: { VAL: mk("answer") } }),
            mk("if_else", {
              i: { COND: mk("op_and", { i: {
                A: div(4),
                B: mk("op_or", { i: { A: mk("op_not", { i: { A: div(100) } }), B: div(400) } }) } }) },
              body: [mk("say", { i: { MSG: "Leap year" } })],
              body2: [mk("say", { i: { MSG: "Not a leap year" } })],
            }),
          ];
        },
      },
      {
        id: "ticket", title: "Ticket price",
        vars: ["Age", "Price"],
        answer: { type: "int", min: 0, max: 120, noun: "an age" },
        brief: "Ask how old the visitor is, then say the ticket price.\n\n" +
               "under 5 \u2192 0\n5 to 17 \u2192 120\n18 to 59 \u2192 250\n60 and over \u2192 100\n\n" +
               "Say the answer as: Pay 250",
        tests: [],
        solution: function () {
          var band = function (cond, p) {
            return mk("if_then", { i: { COND: cond }, body: [mk("set_var", { f: { VAR: "Price" }, i: { VAL: p } })] });
          };
          var lt = function (n) { return mk("op_lt", { i: { A: V("Age"), B: String(n) } }); };
          var gt = function (n) { return mk("op_gt", { i: { A: V("Age"), B: String(n) } }); };
          var bt = function (a, b) { return mk("op_and", { i: { A: gt(a - 1), B: lt(b + 1) } }); };
          return [
            mk("when_flag"),
            mk("ask", { i: { Q: "How old are you?" } }),
            mk("set_var", { f: { VAR: "Age" }, i: { VAL: mk("answer") } }),
            band(lt(5), "0"), band(bt(5, 17), "120"), band(bt(18, 59), "250"), band(gt(59), "100"),
            mk("say_secs", { i: { MSG: mk("op_join", { i: { A: "Pay ", B: V("Price") } }), SECS: "2" } }),
          ];
        },
      },
      {
        id: "model",
        title: "Ask the model",
        vars: ["Input", "Answer"],
        answer: { type: "text" },
        brief: "Ask any question, send it to the model, then say the reply.\n\n" +
               "Flow: ask the student \u2192 store Input \u2192 ask the model \u2192 store Answer from prediction \u2192 say it.\n\n" +
               "Press Run, type any question, and the model answers.",
        tests: [],
        solution: function () {
          return [
            mk("when_flag"),
            mk("ask", { i: { Q: "What should I send to the model?" } }),
            mk("set_var", { f: { VAR: "Input" }, i: { VAL: mk("answer") } }),
            mk("ask_model", { i: { PROMPT: V("Input") } }),
            mk("set_var", { f: { VAR: "Answer" }, i: { VAL: mk("prediction") } }),
            mk("say", { i: {
              MSG: mk("op_join", { i: { A: "The model says: ", B: V("Answer") } })
            } }),
          ];
        },
      },
      {
        id: "blank", title: "Custom",
        vars: ["Answer"],
        answer: { type: "text" },
        brief: "An empty workspace. Use Edit concept to write your own task\n" +
               "and variables, then hand it to the class.",
        tests: [],
      },
    ];

    if (ML) {
      PRESETS = PRESETS.filter(function (p) { return p.id !== "model"; });
    }
    if (mlReady) {
      if (mlImage) PRESETS.unshift({
        id: "ml_image", title: "Image recognition",
        vars: ["Label"],
        answer: { type: "text" },
        brief: "Use your trained model.\n\n" +
               "Press Run and choose an image (upload, webcam or a test image). " +
               "The model recognises it, then Sparky says what it found.\n\n" +
               "Your labels: " + mlLabels.join(", ") + "\n\n" +
               "Try: if recognised label = " + mlLabels[0] + " then say something special.",
        tests: [],
        solution: function () {
          return [
            mk("when_flag"),
            mk("ml_recognise_image"),
            mk("set_var", { f: { VAR: "Label" }, i: { VAL: mk("ml_label") } }),
            mk("if_else", {
              i: { COND: mk("op_eq", { i: { A: V("Label"), B: mk("ml_label_name", { f: { LABEL: mlLabels[0] } }) } }) },
              body: [mk("say", { i: { MSG: mk("op_join", { i: { A: "This looks like ", B: V("Label") } }) } })],
              body2: [mk("say", { i: { MSG: mk("op_join", { i: { A: "I think this is ", B: V("Label") } }) } })],
            }),
          ];
        },
      });
      else PRESETS.unshift({
        id: "ml_text", title: "Text recognition",
        vars: ["Message", "Label"],
        answer: { type: "text" },
        brief: "Use your trained model.\n\n" +
               "Ask for a message, let the model recognise it, then say what it found.\n\n" +
               "Your labels: " + mlLabels.join(", ") + "\n\n" +
               "Try: if recognised label = " + mlLabels[0] + " then say something special.",
        tests: [],
        solution: function () {
          return [
            mk("when_flag"),
            mk("ask", { i: { Q: "Type a message" } }),
            mk("set_var", { f: { VAR: "Message" }, i: { VAL: mk("answer") } }),
            mk("ml_recognise", { i: { TEXT: V("Message") } }),
            mk("set_var", { f: { VAR: "Label" }, i: { VAL: mk("ml_label") } }),
            mk("if_else", {
              i: { COND: mk("op_eq", { i: { A: V("Label"), B: mk("ml_label_name", { f: { LABEL: mlLabels[0] } }) } }) },
              body: [mk("say", { i: { MSG: mk("op_join", { i: { A: "This sounds like ", B: V("Label") } }) } })],
              body2: [mk("say", { i: { MSG: mk("op_join", { i: { A: "I think this is ", B: V("Label") } }) } })],
            }),
          ];
        },
      });
    }

    var BUILTIN_SOLUTIONS = {};
    PRESETS.forEach(function (p) {
      if (p.solution) BUILTIN_SOLUTIONS[p.id] = p.solution;
    });

    // Older saves used a long blank title — keep the dropdown short
    function normalizeConceptTitle(c) {
      if (!c) return c;
      var t = String(c.title || "");
      if (c.id === "blank" || /build anything/i.test(t) || /^blank\s*[—–-]/i.test(t)) {
        c.id = "blank";
        c.title = "Custom";
      }
      return normalizeConceptAnswer(c);
    }

    // Custom / free-form concepts must accept text (names, words). Stale int/number
    // rules from an earlier Python Build or concept switch should not lock the box.
    function conceptWantsTextAnswers(c) {
      if (!c) return true;
      if (c.id === "model") return true;
      // Respect an answer type the teacher set in Edit concept, or the last Python Build
      if (c.answer && (c.answer.fromEdit || c.answer.fromBuild)) return false;
      var tests = c.tests || [];
      for (var i = 0; i < tests.length; i++) {
        var inputs = tests[i].in || tests[i].inputs || [];
        for (var j = 0; j < inputs.length; j++) {
          var v = String(inputs[j] == null ? "" : inputs[j]).trim();
          if (v && !isNum(v)) return true;
        }
      }
      // Custom with no tests + numeric type and no range → almost always a stale Build rule
      if (c.id === "blank" && !tests.length && c.answer &&
          (c.answer.type === "int" || c.answer.type === "number") &&
          c.answer.min == null && c.answer.max == null) {
        return true;
      }
      return false;
    }
    function normalizeConceptAnswer(c) {
      if (!c) return c;
      if (!c.answer || typeof c.answer !== "object") c.answer = { type: "text" };
      if (!c.answer.type) c.answer.type = "text";
      if (conceptWantsTextAnswers(c) && (c.answer.type === "int" || c.answer.type === "number")) {
        c.answer = { type: "text" };
      }
      return c;
    }  
    // ------------------------------------------------------------------ state
    var W = { stacks: [] };
    var concept = null;
    var pan = { x: 40, y: 30 };
    var zoom = 1;
    var ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.1;
    var palModels = {};
    var tab = mlReady ? "ml" : "control";
    var undo = [];
    // True after Clear workspace so an empty save is not replaced by a built-in solution on reload
    var emptyCanvas = false;
    var stoppedRun = false;
  
    var world = $("#world"), wrap = $("#wrap"), dragLayer = $("#drag"), markEl = $("#mark");

    function clampZoom(z) {
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    }
    function applyView() {
      world.style.transform = "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")";
      var lbl = $("#zoomlbl");
      if (lbl) lbl.textContent = Math.round(zoom * 100) + "%";
      var zi = $("#zoomin"), zo = $("#zoomout");
      if (zi) zi.disabled = zoom >= ZOOM_MAX - 1e-6;
      if (zo) zo.disabled = zoom <= ZOOM_MIN + 1e-6;
      paintSelection();
    }
    function setZoom(next, anchorX, anchorY) {
      var wr = wrapRect();
      var ax = anchorX == null ? wr.width / 2 : anchorX;
      var ay = anchorY == null ? wr.height / 2 : anchorY;
      var wx = (ax - pan.x) / zoom;
      var wy = (ay - pan.y) / zoom;
      zoom = clampZoom(next);
      pan.x = ax - wx * zoom;
      pan.y = ay - wy * zoom;
      applyView();
    }
  
    function ctx(editable) {
      var vars = (concept && concept.vars) ? concept.vars.slice() : [];
      return { vars: vars, labels: mlLabels, editable: editable !== false };
    }
    function syncUndoBtn() {
      var btn = $("#undoBtn");
      if (btn) btn.disabled = !undo.length;
    }
    function undoLast() {
      if (!undo.length) return;
      W = JSON.parse(undo.pop());
      select(null);
      render();
      syncUndoBtn();
    }
    function snapshot() {
      undo.push(JSON.stringify(W));
      if (undo.length > 40) undo.shift();
      syncUndoBtn();
    }
  
    // ------------------------------------------------------------------ locate
    function locate(id, arr, owner, key) {
      arr = arr || null;
      var i, r;
      if (!arr) {
        for (i = 0; i < W.stacks.length; i++) {
          r = locate(id, W.stacks[i].blocks, W.stacks[i], "blocks");
          if (r) return r;
        }
        return null;
      }
      for (i = 0; i < arr.length; i++) {
        var b = arr[i];
        if (b.id === id) return { kind: "list", arr: arr, idx: i, owner: owner, key: key };
        var names = Object.keys(b.inputs);
        for (var j = 0; j < names.length; j++) {
          var v = b.inputs[names[j]];
          if (v && typeof v === "object") {
            if (v.id === id) return { kind: "slot", parent: b, name: names[j] };
            r = locateInInput(id, v);
            if (r) return r;
          }
        }
        r = locate(id, b.body, b, "body"); if (r) return r;
        r = locate(id, b.body2, b, "body2"); if (r) return r;
      }
      return null;
    }
    function locateInInput(id, host) {
      var names = Object.keys(host.inputs);
      for (var j = 0; j < names.length; j++) {
        var v = host.inputs[names[j]];
        if (v && typeof v === "object") {
          if (v.id === id) return { kind: "slot", parent: host, name: names[j] };
          var r = locateInInput(id, v);
          if (r) return r;
        }
      }
      return null;
    }
    function findBlock(id, arr) {
      arr = arr || W.stacks.reduce(function (a, s) { return a.concat(s.blocks); }, []);
      for (var i = 0; i < arr.length; i++) {
        var b = arr[i];
        if (b.id === id) return b;
        var kids = [];
        Object.keys(b.inputs).forEach(function (k) {
          var v = b.inputs[k]; if (v && typeof v === "object") kids.push(v);
        });
        var r = findBlock(id, kids.concat(b.body, b.body2));
        if (r) return r;
      }
      return null;
    }
    function defaultFor(op, name) {
      var parts = BL.allParts(BL.SPEC[op]);
      for (var i = 0; i < parts.length; i++)
        if (parts[i].t === "in" && parts[i].n === name) return parts[i].k === "bool" ? null : parts[i].d;
      return "";
    }
  
    // ------------------------------------------------------------------ palette
    function findPresetById(id) {
      for (var i = 0; i < PRESETS.length; i++) {
        if (PRESETS[i].id === id) return PRESETS[i];
      }
      return null;
    }

    function workspaceUsesModel() {
      if (concept && concept.id === "model") return true;
      var found = false;
      function walk(list) {
        (list || []).forEach(function (b) {
          if (!b || found) return;
          if (b.op === "ask_model" || b.op === "prediction") { found = true; return; }
          walk(b.body);
          walk(b.body2);
          Object.keys(b.inputs || {}).forEach(function (k) {
            var v = b.inputs[k];
            if (v && typeof v === "object") walk([v]);
          });
        });
      }
      (W.stacks || []).forEach(function (s) { walk(s.blocks); });
      return found;
    }

    function applyModelTemplate(force) {
      var c = findPresetById("model");
      if (!c) return false;
      // Already showing the Ask-the-model script — just switch to the Model palette
      if (!force && concept && concept.id === "model" && W.stacks.length) {
        tab = "model";
        buildTabs();
        buildPalette();
        return true;
      }
      if (W.stacks.length && concept && concept.id !== "model") {
        if (!confirm("Switch to Ask the model? Your current blocks will be replaced with the default template.")) {
          return false;
        }
      }
      var idx = PRESETS.indexOf(c);
      if (idx > -1) $("#concept").value = String(idx);
      if (R.on) {
        R.stop = true;
        if (R.pending) { var p = R.pending; R.pending = null; p(""); }
        setRunning(false);
      }
      emptyCanvas = false;
      loadConcept(c);
      tab = "model";
      buildTabs();
      buildPalette();
      return true;
    }

    function buildTabs() {
      var t = $("#tabs");
      t.innerHTML = "";
      Object.keys(BL.PALETTE).forEach(function (cat) {
        if (hiddenCat(cat)) return;
        var b = document.createElement("button");
        b.className = "tab" + (cat === tab ? " on" : "");
        b.innerHTML = '<i style="background:' + BL.CAT[cat].dot + '"></i>' + BL.CAT[cat].name;
        if (cat === tab) b.style.background = BL.CAT[cat].dot;
        b.onclick = function () {
          if (cat === "model") {
            applyModelTemplate(false);
            return;
          }
          tab = cat;
          buildTabs();
          buildPalette();
        };
        t.appendChild(b);
      });
    }
    function buildPalette() {
      if (!concept) return;
      var host = $("#palbody");
      if (!host) return;
      host.innerHTML = "";
      palModels = {};
      var ops = BL.PALETTE[tab].slice();
      var list = [];

      function pushOp(op, opts) {
        if (!op || (typeof op === "string" && op.charAt(0) === "#")) return;
        list.push(opts ? { kind: "op", op: op, opts: opts } : { kind: "op", op: op });
      }
      function pushSec(label, pin) {
        list.push({ kind: "sec", label: label, pin: !!pin });
      }

      // When an if / wait-until / etc. is selected with an empty condition,
      // pin the three most useful compare blocks at the top.
      if (tab === "operators" && selectedNeedsCompare()) {
        pushSec("For your if", true);
        // Compare for numbers; contains for text (e.g. Answer / prediction)
        ["op_eq", "op_gt", "op_lt", "op_contains"].forEach(function (op) { pushOp(op); });
      }

      ops.forEach(function (op) {
        if (typeof op === "string" && op.charAt(0) === "#") pushSec(op.slice(1), false);
        else pushOp(op);
      });

      // Machine Learning: one block per trained label, to compare with recognised label
      if (tab === "ml") {
        list = list.filter(function (it) {
          return !(it.kind === "op" && it.op === (mlImage ? "ml_recognise" : "ml_recognise_image"));
        });
        var at = -1;
        for (var li = 0; li < list.length; li++) if (list[li].kind === "op" && list[li].op === "ml_label_name") at = li;
        if (at > -1) {
          var labelItems = mlLabels.map(function (l) { return { kind: "op", op: "ml_label_name", opts: { f: { LABEL: l } } }; });
          list.splice.apply(list, [at, 1].concat(labelItems));
        }
      }

      // Variables: show reporters for this concept under their own section (above Change)
      if (tab === "data" && concept.vars && concept.vars.length) {
        var varItems = [{ kind: "sec", label: "Your variables", pin: false }];
        concept.vars.forEach(function (v) {
          varItems.push({ kind: "op", op: "var_get", opts: { f: { VAR: v } } });
        });
        list = varItems.concat(list);
      }

      list.forEach(function (item) {
        if (item.kind === "sec") {
          var h = document.createElement("div");
          h.className = "palsec" + (item.pin ? " pin" : "");
          h.textContent = item.label;
          host.appendChild(h);
          return;
        }
        var b = item.opts ? mk(item.op, item.opts) : mk(item.op);
        palModels[b.id] = b;
        host.appendChild(BL.renderBlock(b, ctx(false)));
      });
      BL.paint(host);
      palettePinKey = palettePinState();
    }

    var palettePinKey = "";
    function palettePinState() {
      return tab + "|" + (tab === "operators" && selectedNeedsCompare() ? "1" : "0");
    }
    function refreshPalettePins() {
      if (!concept) return;
      var key = palettePinState();
      if (key === palettePinKey) return;
      buildPalette();
    }

    var COND_BLOCK_OPS = {
      if_then: 1, if_else: 1, wait_until: 1, repeat_until: 1, op_if: 1,
    };
    function blockNeedsCond(b) {
      return !!(b && COND_BLOCK_OPS[b.op] && (b.inputs.COND == null || b.inputs.COND === ""));
    }
    function selectedNeedsCompare() {
      return blockNeedsCond(selId ? findBlock(selId) : null);
    }
    function findEmptyCondBlocks() {
      var out = [];
      function walk(list) {
        (list || []).forEach(function (b) {
          if (!b) return;
          if (blockNeedsCond(b)) out.push(b);
          Object.keys(b.inputs || {}).forEach(function (k) {
            var v = b.inputs[k];
            if (v && typeof v === "object") walk([v]);
          });
          walk(b.body);
          walk(b.body2);
        });
      }
      (W.stacks || []).forEach(function (s) { walk(s.blocks); });
      return out;
    }
    function updateBlockCoach() {
      var el = $("#blkcoach");
      if (!el) return;
      var focus = selId ? findBlock(selId) : null;
      var empty = findEmptyCondBlocks();
      if (blockNeedsCond(focus)) {
        el.classList.add("on");
        el.innerHTML = "<b>This if needs a condition (hexagon).</b> " +
          "Ovals like <b>Answer</b> cannot go directly in the if — drop a green condition first " +
          "(<b>contains</b> or <b>=</b>), then put <b>Answer</b> inside that. " +
          "Open <b>Operators</b> — pinned at the top.";
        return;
      }
      if (empty.length) {
        el.classList.add("on");
        el.innerHTML = "<b>" + empty.length + " empty condition slot" +
          (empty.length > 1 ? "s" : "") + ".</b> " +
          "Fill each hexagon with a green condition from <b>Operators</b> " +
          "(e.g. <b>contains</b> for text like Answer).";
        return;
      }
      el.classList.remove("on");
      el.innerHTML = "";
    }
  
    // ------------------------------------------------------------------ render
    function render() {
      world.innerHTML = "";
      applyView();
      W.stacks.forEach(function (s) {
        var d = document.createElement("div");
        d.className = "stack";
        d.style.left = s.x + "px";
        d.style.top = s.y + "px";
        var stk = BL.renderStack(s.blocks, ctx(true));
        stk._arr = s.blocks;
        d.appendChild(stk);
        world.appendChild(d);
      });
      BL.paint(world);
      linkArrays(world);
      $("#hint").style.display = W.stacks.length ? "none" : "";
      paintSelection();
      updateBlockCoach();
      refreshPalettePins();
      drawWatchers();
      if ($("#p-code").classList.contains("on")) renderCode();
    }
    // attach model arrays to mouth containers so drops know where to insert
    function linkArrays(root) {
      var mos = root.querySelectorAll(".mo");
      for (var i = 0; i < mos.length; i++) {
        var b = findBlock(mos[i].dataset.owner);
        if (b) mos[i]._arr = b[mos[i].dataset.body];
      }
    }
  
    // ------------------------------------------------------------------ drag
    var drag = null, pending = null, selId = null;
    var lastPtr = { x: 0, y: 0 };

    function wrapRect() { return wrap.getBoundingClientRect(); }
    function sid() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function ptrInWrap(clientX, clientY) {
      var wr = wrapRect();
      return { x: clientX - wr.left, y: clientY - wr.top };
    }

    on(document, "pointerdown", function (e) {
      if (e.button) return;
      if (e.target.closest && e.target.closest("#menu")) return;   // let the menu item receive its click
      hideMenu();
      var blkEl = e.target.closest && e.target.closest(".blk");
      if (!blkEl) {
        if (e.target.closest && e.target.closest("#wrap") &&
            !e.target.closest(".runbar,.feat,.zoombar,.rsplit,#xbtn,button,a,input,select,textarea")) {
          select(null); startPan(e);
        }
        return;
      }
      if (e.target.closest("input,select")) return;
      e.preventDefault();
      var r = blkEl.getBoundingClientRect();
      pending = {
        id: blkEl.dataset.id,
        inPal: !!e.target.closest("#palbody"),
        sx: e.clientX, sy: e.clientY,
        offX: e.clientX - r.left, offY: e.clientY - r.top,
      };
    });
  
    function beginDrag(e) {
      var p = pending;
      var blkEl = (p.inPal ? $("#palbody") : world).querySelector('.blk[data-id="' + p.id + '"]');
      if (!blkEl) { pending = null; return; }
      var group;
  
      if (p.inPal) {
        group = [BL.clone(palModels[p.id])];
      } else {
        snapshot();
        var top = topLevelStackOf(p.id);
        if (top && top.blocks[0] && top.blocks[0].id === p.id) {
          group = top.blocks;
          W.stacks.splice(W.stacks.indexOf(top), 1);
        } else {
          var loc = locate(p.id);
          if (!loc) { pending = null; return; }
          if (loc.kind === "list") group = loc.arr.splice(loc.idx);
          else {
            group = [loc.parent.inputs[loc.name]];
            loc.parent.inputs[loc.name] = defaultFor(loc.parent.op, loc.name);
          }
        }
        select(null);
        render();
      }
  
      drag = {
        blocks: group, shape: BL.SPEC[group[0].op].shape,
        offX: p.offX, offY: p.offY, fromPalette: p.inPal, target: null,
      };
      pending = null;
      $("#xbtn").classList.remove("on");
      dragLayer.innerHTML = "";
      var stk = BL.renderStack(group, ctx(true));
      dragLayer.appendChild(stk);
      BL.paint(dragLayer);
      drag.w = stk.offsetWidth;
      lastPtr = ptrInWrap(e.clientX, e.clientY);
      moveDrag(e);
      drag.targets = computeTargets(drag.shape);
      if (drag.shape === "rep" || drag.shape === "bool") showCompatibleSlots(drag.shape);
      document.body.style.cursor = "grabbing";
    }
  
    function topLevelStackOf(id) {
      for (var i = 0; i < W.stacks.length; i++)
        if (W.stacks[i].blocks[0] && W.stacks[i].blocks[0].id === id) return W.stacks[i];
      return null;
    }
    function stackContaining(id) {
      for (var i = 0; i < W.stacks.length; i++) {
        if (locate(id, W.stacks[i].blocks, W.stacks[i], "blocks")) return W.stacks[i];
      }
      return null;
    }
  
    function moveDrag(e) {
      var wr = wrapRect();
      drag.x = e.clientX - wr.left - drag.offX;
      drag.y = e.clientY - wr.top - drag.offY;
      dragLayer.style.transform = "translate(" + drag.x + "px," + drag.y + "px)";
    }
  
    // connection points, in wrap-local pixels
    function computeTargets(shape) {
      var out = [], wr = wrapRect();
      if (shape === "rep" || shape === "bool") {
        var slots = world.querySelectorAll(".slot");
        for (var i = 0; i < slots.length; i++) {
          var sl = slots[i];
          if (sl.querySelector(".blk")) continue;
          var kind = sl.dataset.kind;
          if (shape === "bool" && kind !== "bool") continue;
          if (shape === "rep" && kind === "bool") continue;
          var r = sl.getBoundingClientRect();
          // Generous magnet radius around small slots (esp. bool hexagons)
          var pad = kind === "bool" ? 36 : 28;
          out.push({
            type: "slot", el: sl, owner: sl.dataset.owner, name: sl.dataset.slot,
            kind: kind,
            x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height,
            pad: pad * zoom,
          });
        }
        return out;
      }
      if (shape === "hat") return out;               // a hat always starts its own script
      var conts = world.querySelectorAll(".stk,.mo");
      for (var c = 0; c < conts.length; c++) {
        var cont = conts[c], arr = cont._arr;
        if (!arr) continue;
        var kids = [];
        for (var k = 0; k < cont.children.length; k++)
          if (cont.children[k].classList.contains("blk")) kids.push(cont.children[k]);
        var cr = cont.getBoundingClientRect();
        var firstIsHat = arr[0] && BL.SPEC[arr[0].op].shape === "hat";
        if (!firstIsHat)
          out.push({ type: "stack", arr: arr, idx: 0, x: cr.left - wr.left, y: cr.top - wr.top });
        for (var i2 = 0; i2 < kids.length; i2++) {
          var prev = arr[i2];
          if (!prev) continue;
          var sp = BL.SPEC[prev.op];
          if (sp.shape === "cap" || sp.noBottom) continue;   // nothing attaches below these
          var kr = kids[i2].getBoundingClientRect();
          out.push({ type: "stack", arr: arr, idx: i2 + 1,
                     x: kr.left - wr.left, y: kr.bottom - wr.top });
        }
      }
      return out;
    }

    function clearSlotHints() {
      var nodes = world.querySelectorAll(".slot.hi,.slot.magnet");
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.remove("hi");
        nodes[i].classList.remove("magnet");
      }
    }

    function showCompatibleSlots(shape) {
      var slots = world.querySelectorAll(".slot");
      for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        if (sl.querySelector(".blk")) {
          sl.classList.remove("magnet");
          continue;
        }
        var kind = sl.dataset.kind;
        var ok = shape === "bool" ? kind === "bool" : kind !== "bool";
        sl.classList.toggle("magnet", !!ok);
      }
    }

    function pickTarget() {
      // Refresh targets each move so pan/zoom/layout stay accurate
      if (drag) drag.targets = computeTargets(drag.shape);
      var best = null, bd = 1e9;
      var px = lastPtr.x, py = lastPtr.y;
      // Also consider the grab point of the dragged block (helps large blocks)
      var gx = drag.x + Math.min(28, (drag.w || 40) * 0.25);
      var gy = drag.y + 14;
      for (var i = 0; i < drag.targets.length; i++) {
        var t = drag.targets[i], d;
        if (t.type === "slot") {
          var pad = t.pad != null ? t.pad : 28 * zoom;
          var cx = t.x + t.w / 2, cy = t.y + t.h / 2;
          var hitPtr = px >= t.x - pad && px <= t.x + t.w + pad &&
                       py >= t.y - pad && py <= t.y + t.h + pad;
          var hitGrab = gx >= t.x - pad && gx <= t.x + t.w + pad &&
                        gy >= t.y - pad && gy <= t.y + t.h + pad;
          if (!hitPtr && !hitGrab) continue;
          // Prefer pointer proximity to slot center
          d = Math.hypot(px - cx, py - cy);
          if (d < bd) { bd = d; best = t; }
        } else {
          // Stack notches: forgiving horizontal band, moderate vertical
          var maxDx = 110 * zoom, maxDy = 56 * zoom;
          var dx = Math.abs(gx - t.x);
          var dy = Math.abs(gy - t.y);
          var dx2 = Math.abs(px - t.x);
          var dy2 = Math.abs(py - t.y);
          var near = (dx <= maxDx && dy <= maxDy) || (dx2 <= maxDx && dy2 <= maxDy);
          if (!near) continue;
          d = Math.min(dy, dy2) * 2.2 + Math.min(dx, dx2) * 0.45;
          if (d < bd) { bd = d; best = t; }
        }
      }
      return best;
    }

    function showMark(t) {
      clearSlotHints();
      if (drag && (drag.shape === "rep" || drag.shape === "bool")) {
        showCompatibleSlots(drag.shape);
      }
      if (!t) { markEl.style.display = "none"; return; }
      if (t.type === "slot") {
        markEl.style.display = "none";
        t.el.classList.add("hi");
        t.el.classList.remove("magnet");
        return;
      }
      markEl.style.display = "block";
      markEl.style.left = t.x + "px";
      markEl.style.top = (t.y - 5) + "px";
      markEl.style.width = Math.max(72, drag.w || 90) + "px";
    }

    on(document, "pointermove", function (e) {
      if (panning) return doPan(e);
      lastPtr = ptrInWrap(e.clientX, e.clientY);
      if (pending && !drag) {
        // Start drag sooner — feels less “sticky”
        if (Math.abs(e.clientX - pending.sx) + Math.abs(e.clientY - pending.sy) < 3) return;
        beginDrag(e);
        if (!drag) return;
      }
      if (!drag) return;
      moveDrag(e);
      var overPal = !!(e.target.closest && e.target.closest(".pal"));
      $("#pal").classList.toggle("over", overPal && !drag.fromPalette);
      drag.target = overPal ? null : pickTarget();
      showMark(drag.target);
    });
  
    on(document, "pointerup", function (e) {
      if (panning) return endPan();
      if (pending && !drag) {                       // a click, not a drag
        var p = pending; pending = null;
        if (p.inPal) addFromPalette(p.id); else select(p.id);
        return;
      }
      if (!drag) return;
      var d = drag;
      drag = null; pending = null;
      dragLayer.innerHTML = "";
      markEl.style.display = "none";
      clearSlotHints();
      $("#pal").classList.remove("over");
      document.body.style.cursor = "";
  
      var overPal = !!(e.target.closest && e.target.closest(".pal"));
      if (overPal) { render(); return; }                  // dropped on the palette: discard
      if (d.fromPalette) snapshot();
  
      if (d.target && d.target.type === "slot") {
        var owner = findBlock(d.target.owner);
        if (owner) owner.inputs[d.target.name] = d.blocks[0];
      } else if (d.target) {
        var args = [d.target.idx, 0].concat(d.blocks);
        Array.prototype.splice.apply(d.target.arr, args);
      } else {
        W.stacks.push({ id: sid(), x: Math.round((d.x - pan.x) / zoom), y: Math.round((d.y - pan.y) / zoom), blocks: d.blocks });
      }
      render();
      select(d.blocks[0].id);
    });
  
    // clicking a palette block drops it into the workspace
    function addFromPalette(id) {
      if (!palModels[id]) return;
      snapshot();
      var b = BL.clone(palModels[id]);
      var wr = wrapRect();
      var x = Math.round((Math.max(40, wr.width - 340) - pan.x) / zoom);
      var y = Math.round((40 + (W.stacks.length % 9) * 46 - pan.y) / zoom);
      W.stacks.push({ id: sid(), x: x, y: y, blocks: [b] });
      render();
      select(b.id);
    }
  
    // ------------------------------------------------------------------ select & delete
    function select(id) {
      selId = id;
      paintSelection();
      updateBlockCoach();
      refreshPalettePins();
    }
  
    function paintSelection() {
      var prev = world.querySelectorAll(".blk.sel");
      for (var i = 0; i < prev.length; i++) prev[i].classList.remove("sel");
      var xb = $("#xbtn");
      if (!selId) { xb.classList.remove("on"); return; }
      var el = world.querySelector('.blk[data-id="' + selId + '"]');
      if (!el) { selId = null; xb.classList.remove("on"); return; }
      el.classList.add("sel");
      var r = el.getBoundingClientRect(), wr = wrapRect();
      xb.style.left = (r.right - wr.left - 9) + "px";
      xb.style.top = (r.top - wr.top - 9) + "px";
      xb.classList.add("on");
    }
  
    function pruneStacks() {
      W.stacks = W.stacks.filter(function (s) { return s.blocks.length; });
    }
  
    function deleteBlock(id, withFollowers) {
      var loc = locate(id);
      if (!loc) return;
      snapshot();
      if (loc.kind === "slot") loc.parent.inputs[loc.name] = defaultFor(loc.parent.op, loc.name);
      else if (withFollowers) loc.arr.splice(loc.idx);
      else loc.arr.splice(loc.idx, 1);
      pruneStacks();
      select(null);
      render();
    }
    function deleteScript(id) {
      var st = stackContaining(id);
      if (!st) return;
      snapshot();
      W.stacks.splice(W.stacks.indexOf(st), 1);
      select(null);
      render();
    }
    function duplicateBlock(id) {
      var loc = locate(id);
      if (!loc) return;
      snapshot();
      var src = loc.kind === "slot" ? loc.parent.inputs[loc.name] : loc.arr[loc.idx];
      var copy = BL.clone(src);
      if (loc.kind === "list") loc.arr.splice(loc.idx + 1, 0, copy);
      else {
        var st = stackContaining(id);
        W.stacks.push({ id: sid(), x: (st ? st.x : 40) + 30, y: (st ? st.y : 40) + 30, blocks: [copy] });
      }
      render();
      select(copy.id);
    }
  
    $("#xbtn").addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    $("#xbtn").onclick = function () { if (selId) deleteBlock(selId, false); };
  
    // ------------------------------------------------------------------ context menu
    function hideMenu() { $("#menu").classList.remove("on"); }
    function showMenu(x, y, id) {
      var m = $("#menu"), loc = locate(id);
      if (!loc) return;
      m.innerHTML = "";
      var items = [["Duplicate", function () { duplicateBlock(id); }]];
      if (loc.kind === "list") {
        items.push(["Delete this block", function () { deleteBlock(id, false); }, "danger"]);
        if (loc.idx < loc.arr.length - 1)
          items.push(["Delete this and the ones below", function () { deleteBlock(id, true); }, "danger"]);
        items.push(["Delete the whole script", function () { deleteScript(id); }, "danger"]);
      } else {
        items.push(["Delete this block", function () { deleteBlock(id, false); }, "danger"]);
      }
      items.forEach(function (it, i) {
        if (it[2] && (!items[i - 1] || !items[i - 1][2])) m.appendChild(document.createElement("hr"));
        var b = document.createElement("button");
        b.textContent = it[0];
        if (it[2]) b.className = it[2];
        b.onclick = function () { hideMenu(); it[1](); };
        m.appendChild(b);
      });
      m.classList.add("on");
      m.style.left = Math.min(x, window.innerWidth - 220) + "px";
      m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 10) + "px";
    }
    on(document, "contextmenu", function (e) {
      var blkEl = e.target.closest && e.target.closest(".blk");
      if (!blkEl || e.target.closest("#palbody")) return;
      e.preventDefault();
      select(blkEl.dataset.id);
      showMenu(e.clientX, e.clientY, blkEl.dataset.id);
    });
  
    // typing into a block field
    on(document, "input", function (e) {
      var t = e.target;
      if (t.classList.contains("fld")) {
        var b = findBlock(t.dataset.owner) || palModels[t.dataset.owner];
        if (b) b.inputs[t.dataset.input] = t.value;
        BL.sizeField(t);
        BL.paint(world);
        paintSelection();
        if ($("#p-code").classList.contains("on")) renderCode();
      }
    });
    on(document, "change", function (e) {
      var t = e.target;
      if (t.classList.contains("dd")) {
        var b = findBlock(t.dataset.owner || (t.closest(".blk") || {}).dataset.id);
        if (!b) { var host = t.closest(".blk"); b = host && findBlock(host.dataset.id); }
        if (b) {
          b.fields[t.dataset.field] = t.value;
          BL.paint(world);
          if ($("#p-code").classList.contains("on")) renderCode();
        }
      }
    });
  
    // ------------------------------------------------------------------ panning + zoom
    var panning = null;
    function startPan(e) { panning = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }
    function doPan(e) {
      pan.x = panning.px + (e.clientX - panning.x);
      pan.y = panning.py + (e.clientY - panning.y);
      applyView();
    }
    function endPan() { panning = null; }

    on(wrap, "wheel", function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var wr = wrapRect();
        var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setZoom(zoom * factor, e.clientX - wr.left, e.clientY - wr.top);
        return;
      }
      pan.x -= e.deltaX; pan.y -= e.deltaY;
      applyView();
    }, { passive: false });

    if ($("#zoomin")) {
      on($("#zoomin"), "click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setZoom(zoom + ZOOM_STEP);
      });
    }
    if ($("#zoomout")) {
      on($("#zoomout"), "click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setZoom(zoom - ZOOM_STEP);
      });
    }
  
    on(document, "keydown", function (e) {
      if (e.target.closest && e.target.closest("input,textarea,select")) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && undo.length) {
        e.preventDefault();
        undoLast();
        return;
      }
      if (mod && (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        setZoom(zoom + ZOOM_STEP);
        return;
      }
      if (mod && (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        setZoom(zoom - ZOOM_STEP);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        zoom = 1;
        applyView();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && selId) { e.preventDefault(); duplicateBlock(selId); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selId) {
        e.preventDefault();
        deleteBlock(selId, e.shiftKey);
        return;
      }
      if (e.key === "Escape") { select(null); hideMenu(); }
    });
  
    // ------------------------------------------------------------------ runtime
    var R = { on: false, stop: false, fast: false, auto: false, stepMs: 0, queue: [], outs: [], vars: {}, vis: {},
              answer: "", prediction: "", mlLabel: "", mlConf: 0, pending: null, keys: {}, t0: Date.now(), depth: 0,
              assigned: {}, warnedUnset: {} };
  
    function keyName(e) {
      var k = e.key;
      if (k === " " || k === "Spacebar") return "space";
      if (k === "Enter") return "enter";
      if (k === "ArrowUp") return "up arrow";
      if (k === "ArrowDown") return "down arrow";
      if (k === "ArrowLeft") return "left arrow";
      if (k === "ArrowRight") return "right arrow";
      if (k && k.length === 1) return k.toLowerCase();
      return null;
    }
    function keyHeld(name) {
      if (name === "any") { for (var k in R.keys) if (R.keys[k]) return true; return false; }
      return !!R.keys[name];
    }
    on(document, "keydown", function (e) {
      var n = keyName(e);
      if (!n) return;
      R.keys[n] = true;
      if (R.fast) return;                                  // never during a Check run
      if (e.target.closest && e.target.closest("input,textarea,select")) return;
      var hats = W.stacks.filter(function (st) {
        var h = st.blocks[0];
        return h && h.op === "when_key" && (h.fields.KEY === "any" || h.fields.KEY === n);
      });
      if (!hats.length) return;
      R.stop = false;                                      // a key press starts its own script
      hats.forEach(function (st) { execList(st.blocks.slice(1)); });
    });
    on(document, "keyup", function (e) {
      var n = keyName(e);
      if (n) R.keys[n] = false;
    });
  
    async function broadcast(msg, wait) {
      var want = norm(msg);
      var targets = W.stacks.filter(function (st) {
        var h = st.blocks[0];
        return h && h.op === "when_recv" && norm(evalVal(h.inputs.MSG)) === want;
      });
      if (!targets.length) return;
      if (++R.depth > 30) { R.depth--; throw new Error("loop"); }
      try {
        var runs = targets.map(function (st) { return execList(st.blocks.slice(1)); });
        if (wait || R.fast) await Promise.all(runs);   // tests always wait, so results are deterministic
      } finally { R.depth--; }
    }
  
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function norm(s) { return String(s).trim().replace(/\s+/g, " ").toLowerCase(); }
    function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function isNum(v) { return v !== "" && v !== null && !isNaN(parseFloat(v)) && isFinite(v); }
  
    function resetVars() {
      R.vars = {}; R.vis = {}; R.answer = ""; R.prediction = ""; R.mlLabel = ""; R.mlConf = 0;
      R.assigned = {}; R.warnedUnset = {};
      concept.vars.forEach(function (v) { R.vars[v] = 0; R.vis[v] = true; });
      drawWatchers();
    }
    function markAssigned(name) {
      name = String(name || "").trim();
      if (name) R.assigned[name] = 1;
    }
    function warnUnsetVar(name) {
      name = String(name || "").trim();
      if (!name || R.assigned[name] || R.warnedUnset[name]) return;
      R.warnedUnset[name] = 1;
      if (!R.fast) logLine("warn", "!", name + " was never set — using 0");
    }
    function varsInWorkspace() {
      var found = {}, order = [];
      function add(name) {
        name = String(name || "").trim();
        if (!name || found[name]) return;
        found[name] = 1;
        order.push(name);
      }
      function walk(list) {
        (list || []).forEach(function (b) {
          if (!b) return;
          if (b.fields) {
            if (b.fields.VAR) add(b.fields.VAR);
            if (b.fields.LIST) add(b.fields.LIST);
          }
          Object.keys(b.inputs || {}).forEach(function (k) {
            var v = b.inputs[k];
            if (v && typeof v === "object") walk([v]);
          });
          walk(b.body);
          walk(b.body2);
        });
      }
      (W.stacks || []).forEach(function (s) { walk(s.blocks); });
      return order;
    }
    function pruneConceptVarsToWorkspace() {
      var used = varsInWorkspace();
      if (used.length) concept.vars = used;
      else if (concept.id === "blank") concept.vars = ["Answer"];
      // keep declared concept vars otherwise (built-ins)
    }
    function drawWatchers() {
      // Variable chips removed from the Stage UI.
    }
    function fmtWatch(v) {
      if (Array.isArray(v)) {
        try { return JSON.stringify(v); } catch (e) { return "[list]"; }
      }
      return String(v);
    }
    function ensureList(name) {
      if (!Array.isArray(R.vars[name])) R.vars[name] = [];
      return R.vars[name];
    }
    function asList(v) {
      if (Array.isArray(v)) return v;
      if (v == null || v === "") return [];
      if (typeof v === "string") return v.split("");
      return [v];
    }
    function evalListRef(v) {
      if (v != null && typeof v === "object") return asList(evalVal(v));
      if (typeof v === "string" && Object.prototype.hasOwnProperty.call(R.vars, v))
        return asList(R.vars[v]);
      return asList(v);
    }
    function esc(s) {
      return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
    }
    var moodTimer = null;
    var moodHoldUntil = 0;
    var moodQueue = [];
    var MOOD_HOLD = {
      idle: 0,
      listen: 450,
      type: 0,
      speak: 850,
      think: 700,
      cheer: 1100,
      wait: 650
    };

    function applyBuddyMood(mood, line) {
      var stage = $("#play-stage");
      var buddy = $("#buddy");
      var speech = $("#stage-line");
      var tag = $("#speech-tag");
      var m = mood || "idle";
      if (stage) stage.setAttribute("data-mood", m);
      if (buddy) buddy.setAttribute("data-mood", m);
      if (speech && line != null) {
        if (m === "idle" && /Press Run/i.test(String(line))) {
          speech.innerHTML = "Hi! Press <b>Run</b> and I\u2019ll act out your script.";
        } else {
          speech.textContent = String(line);
        }
      }
      if (tag) {
        var tags = {
          idle: "Sparky",
          listen: "Waiting",
          type: "Listening",
          speak: "Saying",
          think: "Thinking",
          cheer: "Nice!",
          wait: "Hmm"
        };
        tag.textContent = tags[m] || "Sparky";
      }
    }

    function flushMoodQueue() {
      moodTimer = null;
      moodHoldUntil = 0;
      if (!moodQueue.length) return;
      var next = moodQueue.shift();
      // Collapse stale type/listen updates — keep the latest of those
      while (moodQueue.length && (next.mood === "type" || next.mood === "listen") &&
             (moodQueue[0].mood === "type" || moodQueue[0].mood === "listen")) {
        next = moodQueue.shift();
      }
      applyBuddyMood(next.mood, next.line);
      scheduleMoodHold(next.mood);
    }

    function scheduleMoodHold(mood) {
      var hold = MOOD_HOLD[mood] != null ? MOOD_HOLD[mood] : 400;
      if (hold <= 0 && !moodQueue.length) return;
      var wait = Math.max(hold, moodQueue.length ? 80 : 0);
      moodHoldUntil = Date.now() + wait;
      moodTimer = setTimeout(flushMoodQueue, wait);
    }

    function setBuddyMood(mood, line, opts) {
      var m = mood || "idle";
      var force = opts && opts.force;
      // Live typing should feel instant
      if (force || m === "type") {
        if (moodTimer) clearTimeout(moodTimer);
        moodTimer = null;
        moodQueue = [];
        moodHoldUntil = 0;
        applyBuddyMood(m, line);
        return;
      }
      var now = Date.now();
      if (moodTimer || now < moodHoldUntil) {
        moodQueue.push({ mood: m, line: line });
        return;
      }
      applyBuddyMood(m, line);
      scheduleMoodHold(m);
    }

    function resetBuddyMoodQueue() {
      if (moodTimer) clearTimeout(moodTimer);
      moodTimer = null;
      moodQueue = [];
      moodHoldUntil = 0;
    }
    function logLine(kind, glyph, text, opts) {
      if (R.fast || R.auto) return;
      var skipMood = opts && opts.skipMood;
      var c = $("#console"), ph = c && c.querySelector(".ph");
      if (ph) ph.remove();
      if (!R._turn) R._turn = 0;
      if (kind === "ask") R._turn += 1;

      var roles = {
        out: "Sparky",
        ask: "Sparky",
        in: "You",
        think: "Sparky",
        sys: "",
        warn: "Note"
      };
      var side = kind === "in" ? "from-you" : (kind === "sys" ? "from-stage" : "from-host");
      var d = document.createElement("div");
      d.className = "cl " + kind + " " + side;

      var rail = document.createElement("div");
      rail.className = "cl-rail";
      rail.setAttribute("aria-hidden", "true");
      var node = document.createElement("span");
      node.className = "cl-node";
      node.textContent = glyph;
      rail.appendChild(node);

      var card = document.createElement("div");
      card.className = "cl-card";
      if (roles[kind]) {
        var role = document.createElement("span");
        role.className = "cl-role";
        role.textContent = roles[kind];
        card.appendChild(role);
      }
      var t = document.createElement("span");
      t.className = "cl-text";
      t.textContent = String(text);
      card.appendChild(t);

      if (kind === "sys") {
        d.appendChild(card);
      } else if (kind === "in") {
        d.appendChild(card);
      } else {
        d.appendChild(rail);
        d.appendChild(card);
      }

      if (c) {
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
      }
      if (skipMood) return;
      if (kind === "ask") {
        R._askQ = String(text);
        setBuddyMood("listen", text);
      } else if (kind === "think") setBuddyMood("think", text);
      else if (kind === "out") setBuddyMood("speak", text);
      else if (kind === "in") setBuddyMood("cheer", "Got it \u2014 " + text);
      else if (kind === "warn") setBuddyMood("wait", text);
      else if (kind === "sys" && /try again|Press Enter/i.test(String(text))) {
        setBuddyMood("listen", text);
      } else if (kind === "sys" && /started/i.test(String(text))) {
        R._turn = 0;
        setBuddyMood("speak", "Okay \u2014 let\u2019s go.");
      } else if (kind === "sys" && /stopped|nothing to run|never said/i.test(String(text))) {
        setBuddyMood("wait", text);
      }
    }
    function clearConsole() {
      var c = $("#console");
      var stage = $("#play-stage");
      R._turn = 0;
      R._askQ = "";
      R._again = false;
      resetBuddyMoodQueue();
      if (c) {
        c.innerHTML =
          '<div class="ph">Press <b>Run</b> to start chatting with Sparky.' +
          '<span class="ph-sub">Questions on the left. Your replies on the right.</span></div>';
      }
      if (stage) {
        stage.classList.remove("is-live", "is-cue");
      }
      setBuddyMood("idle", "Hi! Press Run and I\u2019ll act out your script.", { force: true });
    }
    function say(msg) {
      R.outs.push(String(msg));
      logLine("out", "\u203A", msg);
    }


    // what the answer box will accept for this concept
    function rule() {
      // Model Q&A must accept any text, even if another concept left a numeric rule
      if (workspaceUsesModel()) return { type: "text" };
      return concept.answer || { type: "text" };
    }
    function rangeWords(a) {
      if (a.min != null && a.max != null) return " from " + a.min + " to " + a.max;
      if (a.min != null) return " of " + a.min + " or more";
      if (a.max != null) return " of " + a.max + " or less";
      return "";
    }
    function expectedText() {
      var a = rule();
      if (a.type === "text") return workspaceUsesModel() ? "Type your question" : "Type your answer";
      var what = a.type === "int" ? "a whole number" : "a number";
      return "Type " + what + rangeWords(a);
    }
    function checkAnswer(v) {
      var a = rule(), t = String(v == null ? "" : v);
      var trimmed = t.trim();
      // Text answers may be empty (e.g. password length checks). Numbers still require a value.
      if (a.type === "text") return null;
      if (!trimmed) return "Type an answer first \u2014 the box is empty.";
      if (!isNum(trimmed)) return "\u201C" + trimmed + "\u201D is not a number. " + expectedText() + ".";
      var n = parseFloat(trimmed);
      if (a.type === "int" && Math.round(n) !== n) return "That has a decimal point. " + expectedText() + ".";
      if (a.min != null && n < a.min) return n + " is too low. " + expectedText() + ".";
      if (a.max != null && n > a.max) return n + " is too high. " + expectedText() + ".";
      return null;
    }
    function showAnswerError(msg) {
      var err = $("#askerr"), sect = $("#answer");
      if (err) err.textContent = msg || "";
      if (sect) sect.classList.toggle("bad", !!msg);
    }
    function armAnswerBox(on, q) {
      var box = $("#askin"), sect = $("#answer"), stage = $("#play-stage");
      if (!box || !sect) return;
      sect.classList.toggle("live", on);
      if (on) sect.removeAttribute("hidden");
      else sect.setAttribute("hidden", "");
      if (stage) stage.classList.toggle("is-cue", !!on);
      box.disabled = !on;
      var send = $("#asksend");
      if (send) send.disabled = !on;
      if (on) {
        R._askQ = q == null ? "" : String(q);
        box.placeholder = expectedText();
        box.value = "";
        showAnswerError("");
        setBuddyMood("listen", R._askQ || "I\u2019m listening\u2026");
        setTimeout(function () { box.focus(); }, 10);
      } else {
        box.placeholder = "Type your reply\u2026";
        box.value = "";
        showAnswerError("");
      }
    }

    function reactToTyping() {
      if (!R.pending) return;
      var box = $("#askin");
      if (!box) return;
      var v = String(box.value || "").trim();
      if (!v) {
        setBuddyMood("listen", R._askQ || "I\u2019m listening\u2026", { force: true });
        return;
      }
      var preview = v.length > 36 ? v.slice(0, 36) + "\u2026" : v;
      setBuddyMood("type", "Reading: " + preview, { force: true });
    }
  
    function askUser(q) {
      // Auto-feed queued answers for test runs (still animated when not R.fast)
      if (R.fast || R.auto) {
        var queued = R.queue.length ? String(R.queue.shift()) : "";
        var bad = checkAnswer(queued);
        if (bad) throw new Error("badinput:" + queued);   // the box would have refused this
        if (R.auto && !R.fast) {
          return sleep(Math.max(180, (R.stepMs || step()) * 0.7)).then(function () { return queued; });
        }
        return Promise.resolve(queued);
      }
      logLine("ask", "?", q);
      armAnswerBox(true, q);
      return new Promise(function (res) { R.pending = res; });
    }

    /** Run the trained Text Recognition model; sets recognised label and confidence %. */
    async function recogniseText(text) {
      var t = String(text == null ? "" : text).trim();
      R.mlLabel = ""; R.mlConf = 0;
      if (!mlReady) {
        logLine("warn", "!", "Train your Text Recognition model first, then the Machine Learning blocks work.");
        return;
      }
      if (!t) {
        logLine("warn", "!", "Nothing to recognise: the text is empty.");
        return;
      }
      if (!R.fast) {
        logLine("think", "?", "recognise text: " + t);
        setBuddyMood("think", "Let me check with your model…");
      }
      try {
        var res = await ML.recognise(t);
        R.mlLabel = String(res && res.label != null ? res.label : "");
        R.mlConf = Math.round(Number(res && res.confidence) || 0);
        if (!R.fast) logLine("out", "\u203A", R.mlLabel + " (" + R.mlConf + "% confident)");
      } catch (err) {
        logLine("warn", "!", (err && err.message) ? String(err.message) : "The model could not be reached.");
      }
    }

    /** Ask the host to let the learner choose an image, then run the trained Image Recognition model. */
    async function recogniseImage() {
      R.mlLabel = ""; R.mlConf = 0;
      if (!mlReady || !mlImage) {
        logLine("warn", "!", "Train your Image Recognition model first, then the ML Model blocks work.");
        return;
      }
      if (!R.fast) {
        logLine("think", "?", "Choose an image for your model…");
        setBuddyMood("think", "Show me an image…");
      }
      try {
        var res = await ML.recogniseImage();
        if (R.stop) return;
        if (!res) {
          logLine("warn", "!", "No image chosen.");
          return;
        }
        R.mlLabel = String(res.label != null ? res.label : "");
        R.mlConf = Math.round(Number(res.confidence) || 0);
        if (!R.fast) logLine("out", "\u203A", (res.name ? res.name + ": " : "") + R.mlLabel + " (" + R.mlConf + "% confident)");
      } catch (err) {
        logLine("warn", "!", (err && err.message) ? String(err.message) : "The model could not be reached.");
      }
    }

    async function callAskModel(prompt) {
      var text = String(prompt == null ? "" : prompt).trim();
      if (!text) {
        return "Type a question first — the model needs something to read.";
      }
      if (typeof options.askModel === "function") {
        try {
          if (!R.fast) {
            setBuddyMood("think", "Hmm… thinking about that…");
          }
          var reply = await options.askModel(text);
          var out = String(reply == null ? "" : reply).trim();
          return out || "I could not think of an answer right now.";
        } catch (err) {
          var msg = (err && err.message) ? String(err.message) : "Model request failed";
          if (!R.fast) logLine("warn", "!", msg);
          return "Sorry, I could not get an answer right now.";
        }
      }
      // Offline / test runs without an API hook
      if (R.fast || R.auto) {
        return "Sample model answer for: " + text;
      }
      if (!R.fast) logLine("warn", "!", "Model is not connected — open this project with a session to ask the LLM.");
      return "Model is not available offline.";
    }
    function submitAnswer() {
      if (!R.pending) return;
      var v = $("#askin").value;
      var bad = checkAnswer(v);
      if (bad) { showAnswerError(bad); $("#askin").focus(); return; }   // keep waiting
      showAnswerError("");
      armAnswerBox(false);
      logLine("in", "\u203A", String(v).trim());
      var p = R.pending; R.pending = null;
      p(String(v).trim());
    }
    $("#asksend").onclick = submitAnswer;
    $("#askin").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") { showAnswerError(""); return; }
      if (R.pending) { submitAnswer(); return; }
      if (runAgainFromEnter()) e.preventDefault();
    });
    $("#askin").addEventListener("input", reactToTyping);
  
    function highlight(b, on) {
      if (R.fast) return;
      var el = world.querySelector('.blk[data-id="' + b.id + '"]');
      if (el) el.classList.toggle("running", on);
    }
  
    function evalIn(b, name) { return evalVal(b.inputs[name]); }
    function evalVal(v) {
      if (v == null) return "";
      if (typeof v !== "object") return v;
      var b = v;
      switch (b.op) {
        case "var_get":
          warnUnsetVar(b.fields.VAR);
          return R.vars[b.fields.VAR] == null ? 0 : R.vars[b.fields.VAR];
        case "answer": return R.answer;
        case "answer_empty": return String(R.answer || "").trim() === "";
        case "prediction": return R.prediction;
        case "ml_label": return R.mlLabel;
        case "ml_confidence": return R.mlConf;
        case "ml_label_name": return String(b.fields.LABEL || "");
        case "op_add": return num(evalIn(b, "A")) + num(evalIn(b, "B"));
        case "op_sub": return num(evalIn(b, "A")) - num(evalIn(b, "B"));
        case "op_mul": return num(evalIn(b, "A")) * num(evalIn(b, "B"));
        case "op_div": { var d = num(evalIn(b, "B")); return d === 0 ? 0 : num(evalIn(b, "A")) / d; }
        case "op_mod": { var m = num(evalIn(b, "B")); return m === 0 ? 0 : ((num(evalIn(b, "A")) % m) + m) % m; }
        case "op_round": return Math.round(num(evalIn(b, "A")));
        case "op_num": {
          var raw = evalIn(b, "A");
          return isNum(raw) ? parseFloat(raw) : 0;
        }
        case "op_random": {
          var lo = num(evalIn(b, "A")), hi = num(evalIn(b, "B"));
          if (lo > hi) { var t = lo; lo = hi; hi = t; }
          var whole = String(evalIn(b, "A")).indexOf(".") < 0 && String(evalIn(b, "B")).indexOf(".") < 0;
          return whole ? Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo)
                       : lo + Math.random() * (hi - lo);
        }
        case "op_math": {
          var x = num(evalIn(b, "A"));
          if (b.fields.FN === "abs") return Math.abs(x);
          if (b.fields.FN === "floor") return Math.floor(x);
          if (b.fields.FN === "ceiling") return Math.ceil(x);
          return x < 0 ? 0 : Math.sqrt(x);
        }
        case "op_min": return Math.min(num(evalIn(b, "A")), num(evalIn(b, "B")));
        case "op_max": return Math.max(num(evalIn(b, "A")), num(evalIn(b, "B")));
        case "op_letter": {
          var str = String(evalIn(b, "B")), i = Math.round(num(evalIn(b, "A")));
          return i >= 1 && i <= str.length ? str.charAt(i - 1) : "";
        }
        case "op_length": {
          var lenV = evalIn(b, "A");
          if (Array.isArray(lenV)) return lenV.length;
          return String(lenV).length;
        }
        case "list_item": {
          var li = asList(R.vars[b.fields.LIST]);
          var ix = Math.round(num(evalIn(b, "INDEX")));
          return ix >= 0 && ix < li.length ? li[ix] : "";
        }
        case "list_length": return asList(R.vars[b.fields.LIST]).length;
        case "list_contains": {
          var hayL = asList(R.vars[b.fields.LIST]);
          var needle = evalIn(b, "ITEM");
          return hayL.some(function (x) { return cmp(x, needle) === 0; });
        }
        case "list_make":
          return (b.items || []).map(function (it) { return evalVal(it); });
        case "op_if": return evalIn(b, "COND") ? evalIn(b, "A") : evalIn(b, "B");
        case "key_down": return keyHeld(b.fields.KEY);
        case "timer": return Math.round((Date.now() - R.t0) / 100) / 10;
        case "current": {
          var d = new Date();
          switch (b.fields.UNIT) {
            case "year": return d.getFullYear();
            case "month": return d.getMonth() + 1;
            case "date": return d.getDate();
            case "day of week": return d.getDay() + 1;
            case "hour": return d.getHours();
            case "minute": return d.getMinutes();
            default: return d.getSeconds();
          }
        }
        case "op_join": return String(evalIn(b, "A")) + String(evalIn(b, "B"));
        case "op_lt": return cmp(evalIn(b, "A"), evalIn(b, "B")) < 0;
        case "op_gt": return cmp(evalIn(b, "A"), evalIn(b, "B")) > 0;
        case "op_eq": return cmp(evalIn(b, "A"), evalIn(b, "B")) === 0;
        case "op_ne": return cmp(evalIn(b, "A"), evalIn(b, "B")) !== 0;
        case "op_ge": return cmp(evalIn(b, "A"), evalIn(b, "B")) >= 0;
        case "op_le": return cmp(evalIn(b, "A"), evalIn(b, "B")) <= 0;
        case "op_and": return !!evalIn(b, "A") && !!evalIn(b, "B");
        case "op_or": return !!evalIn(b, "A") || !!evalIn(b, "B");
        case "op_not": return !evalIn(b, "A");
        case "op_true": return 1;
        case "op_false": return 0;
        case "op_contains": {
          var ca = evalIn(b, "A"), cb = evalIn(b, "B");
          if (Array.isArray(ca)) return ca.some(function (x) { return cmp(x, cb) === 0; });
          return String(ca).toLowerCase().indexOf(String(cb).toLowerCase()) > -1;
        }
        case "op_startswith":
          return String(evalIn(b, "A")).toLowerCase().indexOf(String(evalIn(b, "B")).toLowerCase()) === 0;
        case "op_endswith": {
          var hay = String(evalIn(b, "A")).toLowerCase();
          var needle = String(evalIn(b, "B")).toLowerCase();
          return needle === "" || hay.slice(-needle.length) === needle;
        }
      }
      return "";
    }
    function cmp(a, b) {
      if (isNum(a) && isNum(b)) { var x = parseFloat(a), y = parseFloat(b); return x < y ? -1 : x > y ? 1 : 0; }
      var s = String(a).toLowerCase(), t = String(b).toLowerCase();
      return s < t ? -1 : s > t ? 1 : 0;
    }
  
    var GUARD = 20000;
    function step() { return R.stepMs > 0 ? R.stepMs : 220; }   // steady pace through the blocks

    function sayPauseMs(secs) {
      var full = Math.min(3, Math.max(0, num(secs))) * 1000;
      // Test runs: short beat so say/think don't drag, but still feel paced
      if (R.auto && !R.fast) return Math.min(420, Math.max(220, full ? 320 : 220));
      return full;
    }
  
    async function execList(list) {
      for (var i = 0; i < list.length; i++) {
        if (R.stop) return "stop";
        var r = await execBlock(list[i]);
        if (r === "stop" || r === "break" || r === "continue") return r;
      }
      return null;
    }
  
    async function execBlock(b) {
      highlight(b, true);
      if (!R.fast) await sleep(step());
      var res = null, n, i, lst, ix;
      switch (b.op) {
        case "set_var":
          R.vars[b.fields.VAR] = evalIn(b, "VAL");
          markAssigned(b.fields.VAR);
          drawWatchers();
          break;
        case "change_var":
          R.vars[b.fields.VAR] = num(R.vars[b.fields.VAR]) + num(evalIn(b, "BY"));
          markAssigned(b.fields.VAR);
          drawWatchers();
          break;
        case "show_var": R.vis[b.fields.VAR] = true; drawWatchers(); break;
        case "hide_var": R.vis[b.fields.VAR] = false; drawWatchers(); break;
        case "list_add":
          ensureList(b.fields.LIST).push(evalIn(b, "ITEM"));
          markAssigned(b.fields.LIST);
          drawWatchers();
          break;
        case "list_delete_all":
          R.vars[b.fields.LIST] = [];
          markAssigned(b.fields.LIST);
          drawWatchers();
          break;
        case "list_delete":
          lst = ensureList(b.fields.LIST);
          ix = Math.round(num(evalIn(b, "INDEX")));
          if (ix >= 0 && ix < lst.length) lst.splice(ix, 1);
          markAssigned(b.fields.LIST);
          drawWatchers();
          break;
        case "list_insert":
          lst = ensureList(b.fields.LIST);
          ix = Math.round(num(evalIn(b, "INDEX")));
          if (ix < 0) ix = 0;
          if (ix > lst.length) ix = lst.length;
          lst.splice(ix, 0, evalIn(b, "ITEM"));
          markAssigned(b.fields.LIST);
          drawWatchers();
          break;
        case "list_replace":
          lst = ensureList(b.fields.LIST);
          ix = Math.round(num(evalIn(b, "INDEX")));
          if (ix >= 0 && ix < lst.length) lst[ix] = evalIn(b, "ITEM");
          markAssigned(b.fields.LIST);
          drawWatchers();
          break;
        case "ask":
          highlight(b, false);
          R.answer = await askUser(String(evalIn(b, "Q")));
          if (R.stop) { highlight(b, false); return "stop"; }
          highlight(b, true);
          break;
        case "ask_model":
          highlight(b, false);
          {
            var modelPrompt = String(evalIn(b, "PROMPT"));
            if (!R.fast) logLine("ask", "?", "ask the model about " + modelPrompt);
            R.prediction = await callAskModel(modelPrompt);
            if (!R.fast) logLine("out", "\u203A", R.prediction);
          }
          if (R.stop) { highlight(b, false); return "stop"; }
          highlight(b, true);
          break;
        case "ml_recognise_image":
          highlight(b, false);
          await recogniseImage();
          if (R.stop) { highlight(b, false); return "stop"; }
          highlight(b, true);
          break;
        case "ml_recognise":
          highlight(b, false);
          await recogniseText(String(evalIn(b, "TEXT")));
          if (R.stop) { highlight(b, false); return "stop"; }
          highlight(b, true);
          break;
        case "say": say(evalIn(b, "MSG")); break;
        case "say_secs":
          say(evalIn(b, "MSG"));
          if (!R.fast) await sleep(sayPauseMs(evalIn(b, "SECS")));
          break;
        case "think":
          logLine("think", "\u2026", evalIn(b, "MSG"));
          break;
        case "think_secs":
          logLine("think", "\u2026", evalIn(b, "MSG"));
          if (!R.fast) await sleep(sayPauseMs(evalIn(b, "SECS")));
          break;
        case "clear_out":
          if (!R.fast) clearConsole();
          R.outs = [];
          break;
        case "set_answer":
          R.answer = String(evalIn(b, "VAL"));
          break;
        case "note":
          break;
        case "wait":
          if (!R.fast) {
            var waitMs = Math.min(5, Math.max(0, num(evalIn(b, "SECS")))) * 1000;
            if (R.auto) waitMs = Math.min(400, Math.max(220, waitMs ? 300 : 220));
            await sleep(waitMs);
          }
          break;
        case "wait_until":
          i = 0;
          while (!evalIn(b, "COND") && !R.stop) {
            if (++i > (R.fast ? 500 : GUARD)) throw new Error("loop");
            await sleep(R.fast ? 0 : 30);
          }
          break;
        case "reset_timer": R.t0 = Date.now(); break;
        case "broadcast": await broadcast(evalIn(b, "MSG"), false); break;
        case "broadcast_w": await broadcast(evalIn(b, "MSG"), true); break;
        case "if_then": if (evalIn(b, "COND")) res = await execList(b.body); break;
        case "if_else": res = await execList(evalIn(b, "COND") ? b.body : b.body2); break;
        case "repeat":
          n = Math.min(GUARD, Math.max(0, Math.round(num(evalIn(b, "N")))));
          for (i = 0; i < n && !R.stop; i++) {
            res = await execList(b.body);
            if (res === "stop") break;
            if (res === "break") { res = null; break; }
            if (res === "continue") { res = null; continue; }
          }
          break;
        case "repeat_until":
          i = 0;
          while (!evalIn(b, "COND") && !R.stop) {
            if (++i > GUARD) throw new Error("loop");
            res = await execList(b.body);
            if (res === "stop") break;
            if (res === "break") { res = null; break; }
            if (res === "continue") { res = null; continue; }
            if (R.fast && i % 200 === 0) await sleep(0);
          }
          break;
        case "forever":
          i = 0;
          while (!R.stop) {
            if (++i > GUARD) throw new Error("loop");
            res = await execList(b.body);
            if (res === "stop") break;
            if (res === "break") { res = null; break; }
            if (res === "continue") { res = null; continue; }
            if (R.fast && i % 200 === 0) await sleep(0);
          }
          break;
        case "for_each":
          lst = evalListRef(b.inputs.LIST);
          for (i = 0; i < lst.length && !R.stop; i++) {
            R.vars[b.fields.VAR] = lst[i];
            markAssigned(b.fields.VAR);
            drawWatchers();
            res = await execList(b.body);
            if (res === "stop") break;
            if (res === "break") { res = null; break; }
            if (res === "continue") { res = null; continue; }
          }
          break;
        case "break_loop":
          res = "break";
          break;
        case "continue_loop":
          res = "continue";
          break;
        case "stop_all":
          if (b.fields.WHAT === "everything") R.stop = true;
          res = "stop";
          break;
        case "end_script":
          res = "stop";
          break;
      }
      highlight(b, false);
      return res;
    }
  
    function scripts() {
      return W.stacks.filter(function (s) { return s.blocks[0] && s.blocks[0].op === "when_flag"; });
    }
  
    async function runScript(opts) {
      var hats = scripts();
      if (!hats.length) {
        note("Start your script with the <b>Start</b> block (green flag) from <b>Events</b>.", "fail");
        if (!opts.fast) {
          logLine("sys", "!", "Add the Start block from Events, then press Run again.");
          tab = "events";
          buildTabs();
          buildPalette();
        }
        return { ok: false, reason: "nohat" };
      }
      var emptyCond = findEmptyCondBlocks();
      if (emptyCond.length && !opts.fast) {
        note("An <b>if</b> (or wait/repeat until) is missing its condition. " +
          "The hexagon only accepts green condition blocks (e.g. <b>contains</b> or <b>=</b>) — " +
          "not ovals like <b>Answer</b>. Put <b>Answer</b> inside <b>contains</b>.", "fail");
        logLine("sys", "!", "Empty condition — use Operators → contains (or =), then drop Answer inside it.");
        tab = "operators";
        buildTabs();
        buildPalette();
        updateBlockCoach();
      }
      R.stop = false;
      R.fast = !!opts.fast;
      R.auto = !!(opts.auto || opts.fast);
      R.stepMs = opts.stepMs > 0 ? Number(opts.stepMs) : 0;
      R.queue = (opts.answers || []).slice();
      R.outs = [];
      R.t0 = Date.now();
      R.depth = 0;
      resetVars();
  
      try {
        for (var i = 0; i < hats.length; i++) await execList(hats[i].blocks.slice(1));
      } catch (err) {
        var m = String(err.message || "");
        if (m === "loop") return { ok: false, reason: "loop", outs: R.outs };
        if (m.indexOf("badinput:") === 0)
          return { ok: false, reason: "badinput", bad: m.slice(9), outs: R.outs };
        throw err;
      } finally {
        R.auto = false;
        R.stepMs = 0;
      }
      return { ok: true, outs: R.outs, emptyCond: emptyCond.length };
    }
  
    function note(html, cls) {
      $("#results").innerHTML = '<div class="res ' + (cls || "") + '"><span class="m">' +
        (cls === "fail" ? "!" : "i") + '</span><span>' + html + "</span></div>";
    }
  
    function setRunning(on) {
      R.on = on;
      $("#run").disabled = on;
      $("#stop").disabled = !on;
      $("#restart").disabled = false;
    }
  
    // Stage / Python tabs
    function showPane(which) {
      ["out", "code"].forEach(function (k) {
        var pane = $("#p-" + k);
        if (pane) pane.classList.toggle("on", k === which);
      });
      var tabs = $$(".ptab");
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].dataset.p === which);
      if (which === "code") renderCode();
    }
    $$(".ptab").forEach(function (t) {
      t.onclick = function () { showPane(t.dataset.p); };
    });
  
    $("#restart").onclick = function () {
      if (R.on) $("#stop").onclick();
      setTimeout(function () { $("#run").onclick(); }, 60);
    };
  
    function inviteTryAgain(extra) {
      var msg = extra
        ? String(extra)
        : "Nice! Want to try again? Press Enter.";
      R._again = true;
      // Chat line first; face plays cheer, then settles into waiting
      logLine("out", "\u21bb", msg, { skipMood: true });
      setBuddyMood("cheer", "Nice!");
      setBuddyMood("listen", msg);
    }

    function runAgainFromEnter() {
      if (!R._again || R.on || R.pending) return false;
      R._again = false;
      if ($("#restart")) $("#restart").onclick();
      else if ($("#run")) $("#run").onclick();
      return true;
    }

    on(document, "keydown", function (e) {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.target && e.target.closest && e.target.closest("textarea,select,[contenteditable='true']")) return;
      // While answering a question, askin handles Enter
      if (R.pending) return;
      if (runAgainFromEnter()) {
        e.preventDefault();
      }
    });

    $("#run").onclick = async function () {
      normalizeConceptAnswer(concept);
      showPane("out");
      setRunning(true);
      stoppedRun = false;
      R._again = false;
      resetBuddyMoodQueue();
      var stage = $("#play-stage");
      if (stage) stage.classList.add("is-live");
      $("#console").innerHTML = "";
      R._turn = 0;
      setBuddyMood("speak", "Okay \u2014 let\u2019s go.", { force: true });
      var r = await runScript({ fast: false });
      armAnswerBox(false);
      if (r.reason === "loop") {
        logLine("sys", "\u2014", "stopped: that loop never ended \u2014 check your repeat until condition");
      } else if (r.reason === "nohat") {
        logLine("sys", "\u2014", "nothing to run \u2014 start your script with the Start (green flag) block");
      } else if (stoppedRun) {
        logLine("sys", "\u2014", "stopped");
      } else if (r.ok && !r.outs.length) {
        inviteTryAgain("Nothing was said yet \u2014 add a say block, then press Enter to try again.");
      } else if (r.ok) {
        inviteTryAgain("Nice! Want to try again? Press Enter.");
      }

      setRunning(false);
      if (stage) {
        stage.classList.remove("is-cue");
        if (!stoppedRun && r.ok) stage.classList.add("is-live");
      }
    };
  
    $("#stop").onclick = function () {
      stoppedRun = true;
      R.stop = true;
      R._again = false;
      if (R.pending) { var p = R.pending; R.pending = null; p(""); }
      armAnswerBox(false);
      showAnswerError("");
      setRunning(false);
    };
  
  
    // ------------------------------------------------------------------ python view
    // Shows students the code their blocks stand for. Runnable for the usual concepts.
    var PYNEED = {};
  
    function ident(name) {
      var t = String(name || "x").trim().replace(/[^A-Za-z0-9_]/g, "_");
      if (!t || /^[0-9]/.test(t)) t = "v_" + t;
      return t;
    }
    function pyLit(v) {
      var t = String(v);
      if (t === "") return '""';
      return isNum(t) ? t : JSON.stringify(t);
    }
    function px(v) {                       // expression
      if (v == null) return "False";
      if (typeof v !== "object") return pyLit(v);
      var A = function () { return px(v.inputs.A); }, B = function () { return px(v.inputs.B); };
      switch (v.op) {
        case "var_get": return ident(v.fields.VAR);
        case "answer": return "answer";
        case "prediction": return "prediction";
        case "ml_label": return "label";
        case "ml_confidence": return "confidence";
        case "ml_label_name": return pyLit(v.fields.LABEL || "");
        case "op_add": return "(" + A() + " + " + B() + ")";
        case "op_sub": return "(" + A() + " - " + B() + ")";
        case "op_mul": return "(" + A() + " * " + B() + ")";
        case "op_div": return "(" + A() + " / " + B() + ")";
        case "op_mod": return "(" + A() + " % " + B() + ")";
        case "op_round": return "round(" + A() + ")";
        case "op_random": PYNEED.random = 1; return "random.randint(" + A() + ", " + B() + ")";
        case "op_math":
          if (v.fields.FN === "abs") return "abs(" + A() + ")";
          PYNEED.math = 1;
          if (v.fields.FN === "floor") return "math.floor(" + A() + ")";
          if (v.fields.FN === "ceiling") return "math.ceil(" + A() + ")";
          return "math.sqrt(" + A() + ")";
        case "op_join": return "str(" + A() + ") + str(" + B() + ")";
        case "op_letter": return "str(" + B() + ")[" + A() + " - 1]";
        case "op_length": return "len(" + A() + ")";
        case "op_num": return "float(" + A() + ")";
        case "op_min": return "min(" + A() + ", " + B() + ")";
        case "op_max": return "max(" + A() + ", " + B() + ")";
        case "op_if": return "((" + A() + ") if " + px(v.inputs.COND) + " else (" + B() + "))";
        case "list_item": return ident(v.fields.LIST) + "[" + px(v.inputs.INDEX) + "]";
        case "list_length": return "len(" + ident(v.fields.LIST) + ")";
        case "list_contains": return "(" + px(v.inputs.ITEM) + " in " + ident(v.fields.LIST) + ")";
        case "list_make":
          return "[" + (v.items || []).map(function (it) { return px(it); }).join(", ") + "]";
        case "op_lt": return "(" + A() + " < " + B() + ")";
        case "op_gt": return "(" + A() + " > " + B() + ")";
        case "op_eq": return "(" + A() + " == " + B() + ")";
        case "op_ne": return "(" + A() + " != " + B() + ")";
        case "op_ge": return "(" + A() + " >= " + B() + ")";
        case "op_le": return "(" + A() + " <= " + B() + ")";
        case "op_and": return "(" + A() + " and " + B() + ")";
        case "op_or": return "(" + A() + " or " + B() + ")";
        case "op_not": return "(not " + A() + ")";
        case "op_true": return "True";
        case "op_false": return "False";
        case "op_contains": return "(str(" + B() + ").lower() in str(" + A() + ").lower())";
        case "op_startswith": return "str(" + A() + ").lower().startswith(str(" + B() + ").lower())";
        case "op_endswith": return "str(" + A() + ").lower().endswith(str(" + B() + ").lower())";
        case "answer_empty": return '(str(answer).strip() == "")';
        case "timer": PYNEED.time = 1; PYNEED._timer = 1; return "round(time.time() - start, 1)";
        case "current":
          PYNEED.datetime = 1;
          return { "year": "datetime.datetime.now().year", "month": "datetime.datetime.now().month",
                   "date": "datetime.datetime.now().day", "day of week": "datetime.datetime.now().isoweekday()",
                   "hour": "datetime.datetime.now().hour", "minute": "datetime.datetime.now().minute"
                 }[v.fields.UNIT] || "datetime.datetime.now().second";
        case "key_down": return 'key_pressed("' + v.fields.KEY + '")';
      }
      return '""';
    }
  
    function pyBody(list, ind, inFn) {
      var out = [], pad = "    ".repeat(ind);
      if (!list.length) return [pad + "pass"];
      list.forEach(function (b) {
        switch (b.op) {
          case "set_var": out.push(pad + ident(b.fields.VAR) + " = " + px(b.inputs.VAL)); break;
          case "change_var": out.push(pad + ident(b.fields.VAR) + " += " + px(b.inputs.BY)); break;
          case "show_var": case "hide_var":
            out.push(pad + "# " + (b.op === "show_var" ? "show" : "hide") + " the " + ident(b.fields.VAR) + " watcher");
            break;
          case "ask": {
            var q = px(b.inputs.Q), a = rule();
            if (a.type === "int") out.push(pad + "answer = int(input(" + q + "))");
            else if (a.type === "number") out.push(pad + "answer = float(input(" + q + "))");
            else out.push(pad + "answer = input(" + q + ")");
            break;
          }
          case "ask_model":
            out.push(pad + "prediction = ask_model(" + px(b.inputs.PROMPT) + ")");
            break;
          case "ml_recognise":
            out.push(pad + "label, confidence = recognise_text(" + px(b.inputs.TEXT) + ")");
            break;
          case "ml_recognise_image":
            out.push(pad + "label, confidence = recognise_image(choose_image())");
            break;
          case "say": out.push(pad + "print(" + px(b.inputs.MSG) + ")"); break;
          case "say_secs":
            PYNEED.time = 1;
            out.push(pad + "print(" + px(b.inputs.MSG) + ")");
            out.push(pad + "time.sleep(" + px(b.inputs.SECS) + ")");
            break;
          case "think":
            out.push(pad + "print(\"# think: \" + str(" + px(b.inputs.MSG) + "))");
            break;
          case "think_secs":
            PYNEED.time = 1;
            out.push(pad + "print(\"# think: \" + str(" + px(b.inputs.MSG) + "))");
            out.push(pad + "time.sleep(" + px(b.inputs.SECS) + ")");
            break;
          case "clear_out":
            out.push(pad + "# clear output");
            break;
          case "set_answer":
            out.push(pad + "answer = " + px(b.inputs.VAL));
            break;
          case "note":
            out.push(pad + "# " + String(typeof b.inputs.MSG === "object" ? "note" : (b.inputs.MSG || "note")).replace(/\n/g, " "));
            break;
          case "wait": PYNEED.time = 1; out.push(pad + "time.sleep(" + px(b.inputs.SECS) + ")"); break;
          case "wait_until":
            PYNEED.time = 1;
            out.push(pad + "while not " + px(b.inputs.COND) + ":");
            out.push(pad + "    time.sleep(0.03)");
            break;
          case "reset_timer": PYNEED.time = 1; PYNEED._timer = 1; out.push(pad + "start = time.time()"); break;
          case "if_then":
            out.push(pad + "if " + px(b.inputs.COND) + ":");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            break;
          case "if_else":
            out.push(pad + "if " + px(b.inputs.COND) + ":");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            out.push(pad + "else:");
            out = out.concat(pyBody(b.body2, ind + 1, inFn));
            break;
          case "repeat":
            out.push(pad + "for _ in range(int(" + px(b.inputs.N) + ")):");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            break;
          case "repeat_until":
            out.push(pad + "while not " + px(b.inputs.COND) + ":");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            break;
          case "forever":
            out.push(pad + "while True:");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            break;
          case "stop_all":
            out.push(pad + (b.fields.WHAT === "everything" || !inFn ? "raise SystemExit" : "return"));
            break;
          case "end_script":
            out.push(pad + "# End");
            break;
          case "break_loop": out.push(pad + "break"); break;
          case "continue_loop": out.push(pad + "continue"); break;
          case "for_each":
            out.push(pad + "for " + ident(b.fields.VAR) + " in " + px(b.inputs.LIST) + ":");
            out = out.concat(pyBody(b.body, ind + 1, inFn));
            break;
          case "list_add":
            out.push(pad + ident(b.fields.LIST) + ".append(" + px(b.inputs.ITEM) + ")");
            break;
          case "list_delete_all":
            out.push(pad + ident(b.fields.LIST) + ".clear()");
            break;
          case "list_delete":
            out.push(pad + "del " + ident(b.fields.LIST) + "[" + px(b.inputs.INDEX) + "]");
            break;
          case "list_insert":
            out.push(pad + ident(b.fields.LIST) + ".insert(" + px(b.inputs.INDEX) + ", " + px(b.inputs.ITEM) + ")");
            break;
          case "list_replace":
            out.push(pad + ident(b.fields.LIST) + "[" + px(b.inputs.INDEX) + "] = " + px(b.inputs.ITEM));
            break;
          case "broadcast": case "broadcast_w":
            out.push(pad + ident(evalStatic(b.inputs.MSG)) + "()");
            break;
          default: break;
        }
      });
      return out;
    }
    function evalStatic(v) { return (v && typeof v === "object") ? "message" : String(v || "message"); }
  
    function renderCode() {
      PYNEED = {};
      var body = [], defs = [], defs_out = [], hats = [];
      W.stacks.forEach(function (st) {
        var h = st.blocks[0];
        if (!h) return;
        if (h.op === "when_flag") hats.push(st);
        else if (h.op === "when_recv" || h.op === "when_key") defs.push(st);
      });
  
      var vars = concept.vars.map(ident);
      defs.forEach(function (st) {
        var h = st.blocks[0];
        var name = h.op === "when_recv" ? ident(evalStatic(h.inputs.MSG)) : ident("on_" + h.fields.KEY);
        var head = h.op === "when_recv"
          ? '# runs when "' + evalStatic(h.inputs.MSG) + '" is broadcast'
          : "# runs when the " + h.fields.KEY + " key is pressed";
        defs_out.push(head);
        defs_out.push("def " + name + "():");
        if (vars.length) defs_out.push("    global " + vars.join(", "));
        pyBody(st.blocks.slice(1), 1, true).forEach(function (l) { defs_out.push(l); });
        defs_out.push("");
      });
  
      hats.forEach(function (st, i) {
        if (i) body.push("");
        body.push("# Start");
        pyBody(st.blocks.slice(1), 0, false).forEach(function (l) { body.push(l); });
      });
  
      var head = [];
      var imports = Object.keys(PYNEED).filter(function (k) { return k.charAt(0) !== "_"; }).sort();
      if (imports.length) head.push("import " + imports.join(", "));
      if (PYNEED._timer) head.push("start = time.time()");
      if (head.length) head.push("");
  
  
      var text = head.concat(defs_out, body).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (codeDirty) return;                      // don't clobber what the user is typing
      // Keep the editor empty (not a fake comment) so Build is not confused with placeholder text
      $("#code").value = text;
    }
  
    $("#copycode").onclick = function () {
      var el = $("#code"), btn = $("#copycode");
      function flash(title) {
        btn.title = title;
        btn.classList.add("copied");
        setTimeout(function () {
          btn.title = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      }
      function selectIt() {
        el.select();
        flash("Selected — press Ctrl+C");
      }
      function done() { flash("Copied"); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).then(done, selectIt);
      } else selectIt();
    };
  
  
    // ------------------------------------------------------------ python -> blocks
    // Understands the same subset the Python view writes, so the two directions round-trip.
    function perr(line, msg) { var e = new Error(msg); e.line = line; return e; }
  
    function stripComment(s) {
      var out = "", q = null;
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (q) { out += c; if (c === q && s[i - 1] !== "\\") q = null; continue; }
        if (c === '"' || c === "'" || c === "\u201C" || c === "\u2018") {
          q = c === "\u201C" ? "\u201D" : c === "\u2018" ? "\u2019" : c;
          out += c; continue;
        }
        if (c === "#") break;
        out += c;
      }
      return out;
    }
    // is the whole string  name( ... )  ?  returns the inside, or null
    function matchCall(t, name) {
      t = t.trim();
      if (t.indexOf(name + "(") !== 0) return null;
      var depth = 0, q = null;
      for (var i = name.length; i < t.length; i++) {
        var c = t[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (!depth) return i === t.length - 1 ? t.slice(name.length + 1, i) : null; }
      }
      return null;
    }
    function splitArgs(t) {
      var parts = [], depth = 0, q = null, cur = "";
      for (var i = 0; i < t.length; i++) {
        var c = t[i];
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        if (c === "," && !depth) { parts.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
    }
  
    // --- expression tokenizer + recursive descent ---
    var CUR_UNITS = { year: "year", month: "month", day: "date", isoweekday: "day of week",
                      hour: "hour", minute: "minute", second: "second" };
  
    function preClean(t) {
      return t
        .replace(/round\s*\(\s*time\.time\(\)\s*-\s*start\s*,\s*1\s*\)/g, "__TIMER__")
        .replace(/datetime\.datetime\.now\(\)\.(\w+)/g, function (_, u) { return "__CUR_" + (CUR_UNITS[u] || "second").replace(/ /g, "~") + "__"; })
        .replace(/\.lower\(\)/g, "");
    }
    function lex(t, line) {
      var out = [], i = 0;
      var ops = ["==", "<=", ">=", "!=", "+", "-", "*", "/", "%", "<", ">", "(", ")", "[", "]", ",", "."];
      while (i < t.length) {
        var c = t[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[fF]/.test(c) && /["'\u201C\u2018]/.test(t[i + 1] || "")) {
          var qc = t[i + 1], qclose = qc === "\u201C" ? "\u201D" : qc === "\u2018" ? "\u2019" : qc;
          var k = i + 2, raw = "";
          while (k < t.length && t[k] !== qclose) { raw += t[k]; k++; }
          out.push({ k: "fstr", v: raw }); i = k + 1; continue;
        }
        if (c === '"' || c === "'" || c === "\u201C" || c === "\u2018") {
          var close = c === "\u201C" ? "\u201D" : c === "\u2018" ? "\u2019" : c;
          var j = i + 1, v = "";
          while (j < t.length && t[j] !== close) { if (t[j] === "\\") j++; v += t[j]; j++; }
          out.push({ k: "str", v: v }); i = j + 1; continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(t[i + 1] || ""))) {
          var m = /^[0-9]*\.?[0-9]+/.exec(t.slice(i));
          out.push({ k: "num", v: m[0] }); i += m[0].length; continue;
        }
        if (/[A-Za-z_]/.test(c)) {
          var w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(t.slice(i))[0];
          out.push({ k: /^(and|or|not|in|True|False)$/.test(w) ? w : "name", v: w });
          i += w.length; continue;
        }
        var two = t.substr(i, 2), hit = null;
        if (ops.indexOf(two) > -1) hit = two; else if (ops.indexOf(c) > -1) hit = c;
        if (!hit) throw perr(line, "I do not understand the character " + c);
        out.push({ k: "op", v: hit }); i += hit.length; continue;
      }
      return out;
    }
  
    function parseExpr(text, line, seen) {
      var tk = lex(preClean(text), line), p = 0;
      function peek() { return tk[p]; }
      function eat(v) { if (tk[p] && (tk[p].v === v || tk[p].k === v)) return tk[p++]; return null; }
      function need(v) { if (!eat(v)) throw perr(line, "expected " + v + " in: " + text); }
  
      function or1() { var a = and1(); while (eat("or")) a = mk("op_or", { i: { A: unstr(a), B: unstr(and1()) } }); return a; }
      function and1() { var a = not1(); while (eat("and")) a = mk("op_and", { i: { A: unstr(a), B: unstr(not1()) } }); return a; }
      function not1() { if (eat("not")) return mk("op_not", { i: { A: unstr(not1()) } }); return cmp(); }
      function cmp() {
        var a = add();
        var t = peek();
        var CMPOP = { "<": "op_lt", ">": "op_gt", "==": "op_eq",
                      ">=": "op_ge", "<=": "op_le", "!=": "op_ne" };
        if (t && t.k === "op" && CMPOP[t.v]) {
          p++;
          var b = add();
          return mk(CMPOP[t.v], { i: { A: unstr(a), B: unstr(b) } });
        }
        if (t && t.k === "in") { p++; var hay = add(); return mk("op_contains", { i: { A: unstr(hay), B: unstr(a) } }); }
        return a;
      }
      function add() {
        var a = mul();
        for (;;) {
          var t = peek();
          if (!t || t.k !== "op" || (t.v !== "+" && t.v !== "-")) return a;
          p++;
          var b = mul();
          if (t.v === "+" && ((a && a.__str) || (b && b.__str)))
            a = mk("op_join", { i: { A: unstr(a), B: unstr(b) } });
          else a = mk(t.v === "+" ? "op_add" : "op_sub", { i: { A: unstr(a), B: unstr(b) } });
        }
      }
      function mul() {
        var a = un();
        for (;;) {
          var t = peek();
          if (!t || t.k !== "op" || "*/%".indexOf(t.v) < 0) return a;
          p++;
          var b = un();
          a = mk(t.v === "*" ? "op_mul" : t.v === "/" ? "op_div" : "op_mod", { i: { A: unstr(a), B: unstr(b) } });
        }
      }
      function un() {
        if (eat("-")) {
          var v = un();
          if (typeof v !== "object" && isNum(v)) return String(-parseFloat(v));
          return mk("op_sub", { i: { A: "0", B: unstr(v) } });
        }
        return post();
      }
      function post() {
        var v = prim();
        for (;;) {
          if (eat("[")) {                       // xs[i]  or  str(x)[i - 1]
            var idx = or1();
            need("]");
            if (idx && typeof idx === "object" && idx.op === "op_sub" && String(unstr(idx.inputs.B)) === "1"
                && !(v && typeof v === "object" && v.op === "var_get")) {
              v = mk("op_letter", { i: { A: unstr(idx.inputs.A), B: unstr(v) } });
            } else if (v && typeof v === "object" && v.op === "var_get") {
              v = mk("list_item", { f: { LIST: v.fields.VAR }, i: { INDEX: unstr(idx) } });
            } else {
              var one = (idx && typeof idx === "object" && idx.op === "op_sub" && String(unstr(idx.inputs.B)) === "1")
                ? idx.inputs.A : idx;
              v = mk("op_letter", { i: { A: unstr(one), B: unstr(v) } });
            }
            continue;
          }
          return v;
        }
      }
      function prim() {
        var t = peek();
        if (!t) throw perr(line, "the expression ends too early: " + text);
        if (eat("[")) {
          var items = [];
          if (!eat("]")) {
            for (;;) {
              items.push(unstr(or1()));
              if (eat("]")) break;
              need(",");
            }
          }
          return mk("list_make", { items: items });
        }
        if (eat("(")) { var e = tern(); need(")"); return e; }
        if (t.k === "num") { p++; return t.v; }
        if (t.k === "str") { p++; return { __str: true, text: t.v }; }
        if (t.k === "fstr") { p++; return fstring(t.v, line, seen); }
        if (t.k === "True") { p++; return mk("op_true"); }
        if (t.k === "False") { p++; return mk("op_false"); }
        if (t.k === "name") {
          var nm = t.v; p++;
          while (peek() && peek().v === "." ) { p++; nm += "." + (tk[p] ? tk[p].v : ""); p++; }
          if (peek() && peek().v === "(") {                // a call
            var depth = 0, start = p, end = -1;
            for (var q2 = p; q2 < tk.length; q2++) {
              if (tk[q2].v === "(") depth++;
              else if (tk[q2].v === ")") { depth--; if (!depth) { end = q2; break; } }
            }
            if (end < 0) throw perr(line, "unbalanced brackets in: " + text);
            var innerTk = tk.slice(start + 1, end);
            p = end + 1;
            return call(nm, innerTk, line, text);
          }
          if (nm === "__TIMER__") return mk("timer");
          var cm = /^__CUR_(.+)__$/.exec(nm);
          if (cm) return mk("current", { f: { UNIT: cm[1].replace(/~/g, " ") } });
          if (nm === "answer") return mk("answer");
          if (seen) seen[nm] = 1;
          return mk("var_get", { f: { VAR: nm } });
        }
        throw perr(line, "I do not understand: " + text);
      }
      function call(nm, innerTk, line2, whole) {
        var src = tkText(innerTk);
        var args = splitArgs(src).filter(function (a) { return a.indexOf("=") < 0; });
        function E(x) { return parseExpr(x, line2, seen); }
        var parts = nm.split(".");
        if (parts.length === 2) {
          var obj = parts[0], meth = parts[1];
          if (meth === "startswith" && args[0] != null)
            return mk("op_startswith", { i: { A: mk("var_get", { f: { VAR: obj } }), B: unstr(E(args[0])) } });
          if (meth === "endswith" && args[0] != null)
            return mk("op_endswith", { i: { A: mk("var_get", { f: { VAR: obj } }), B: unstr(E(args[0])) } });
          if (meth === "strip" || meth === "lower" || meth === "upper" || meth === "lstrip" || meth === "rstrip") {
            if (seen) seen[obj] = 1;
            return mk("var_get", { f: { VAR: obj } });
          }
        }
        switch (nm) {
          case "int": case "float": return unstr(E(args[0]));
          case "str": { var inner2 = E(args[0]); return { __str: true, joined: true, val: unstr(inner2),
                        text: (typeof unstr(inner2) === "string" ? unstr(inner2) : "") }; }
          case "len": return mk("op_length", { i: { A: unstr(E(args[0])) } });
          case "list": return args[0] != null ? unstr(E(args[0])) : mk("list_make", { items: [] });
          case "round": return mk("op_round", { i: { A: unstr(E(args[0])) } });
          case "abs": return mk("op_math", { f: { FN: "abs" }, i: { A: unstr(E(args[0])) } });
          case "math.floor": return mk("op_math", { f: { FN: "floor" }, i: { A: unstr(E(args[0])) } });
          case "math.ceil": return mk("op_math", { f: { FN: "ceiling" }, i: { A: unstr(E(args[0])) } });
          case "math.sqrt": return mk("op_math", { f: { FN: "sqrt" }, i: { A: unstr(E(args[0])) } });
          case "random.randint": return mk("op_random", { i: { A: unstr(E(args[0])), B: unstr(E(args[1])) } });
          case "min": return mk("op_min", { i: { A: unstr(E(args[0])), B: unstr(E(args[1])) } });
          case "max": return mk("op_max", { i: { A: unstr(E(args[0])), B: unstr(E(args[1])) } });
          case "key_pressed": { var k = E(args[0]); return mk("key_down", { f: { KEY: litOf(k) || "space" } }); }
        }
        throw perr(line2, nm + "() is not one of the blocks");
      }
      function tern() {
        var a = or1();
        var t = peek();
        if (t && t.k === "name" && t.v === "if") {
          p++;
          var c = or1();
          var e = peek();
          if (!(e && e.k === "name" && e.v === "else")) throw perr(line, "ternary needs else: " + text);
          p++;
          var b = or1();
          return mk("op_if", { i: { COND: unstr(c), A: unstr(a), B: unstr(b) } });
        }
        return a;
      }
      var v = tern();
      if (p < tk.length) throw perr(line, "I cannot read all of: " + text);
      return unstr(v);
    }
    function tkText(tk) {
      var s = "";
      tk.forEach(function (t, i) {
        s += (t.k === "str" ? JSON.stringify(t.v) : t.v);
        var nx = tk[i + 1];
        if (nx && /^(and|or|not|in)$/.test(nx.k)) s += " ";
        if (/^(and|or|not|in)$/.test(t.k)) s += " ";
      });
      return s;
    }
    // an f-string becomes a chain of join blocks
    function fstring(raw, line, seen) {
      var parts = [], lit = "", i = 0;
      while (i < raw.length) {
        if (raw[i] === "{") {
          if (raw[i + 1] === "{") { lit += "{"; i += 2; continue; }
          if (lit) { parts.push({ __str: true, text: lit }); lit = ""; }
          var depth = 1, j = i + 1, inner = "";
          while (j < raw.length && depth) {
            if (raw[j] === "{") depth++;
            else if (raw[j] === "}") { depth--; if (!depth) break; }
            inner += raw[j]; j++;
          }
          inner = inner.split(":")[0].replace(/!r$|!s$/, "").trim();
          if (!inner) throw perr(line, "there is an empty { } in the text");
          parts.push(parseExpr(inner, line, seen));
          i = j + 1;
          continue;
        }
        if (raw[i] === "}" && raw[i + 1] === "}") { lit += "}"; i += 2; continue; }
        lit += raw[i]; i++;
      }
      if (lit) parts.push({ __str: true, text: lit });
      if (!parts.length) return { __str: true, text: "" };
      var acc = parts[0];
      for (var q3 = 1; q3 < parts.length; q3++)
        acc = mk("op_join", { i: { A: unstr(acc), B: unstr(parts[q3]) } });
      return acc;
    }
  
    function unstr(v) {
      if (v && typeof v === "object" && v.__str) return v.joined ? v.val : v.text;
      return v;
    }
    function litOf(v) {
      if (v == null) return null;
      if (typeof v !== "object") return String(v);
      return v.__str ? v.text : null;
    }
  
    // --- statements ---
    function parsePython(src) {
      var items = [];
      src.split(/\r?\n/).forEach(function (raw, i) {
        var leadRaw = raw.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
        var trimmedFull = raw.trim();
        // Preserve the End marker before comment stripping (it is a real block, not a discarded comment)
        if (/^#\s*End\b/i.test(trimmedFull)) {
          items.push({ ind: leadRaw, text: "# End", n: i + 1 });
          return;
        }
        var t = stripComment(raw);
        if (!t.trim()) return;
        var lead = t.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
        items.push({ ind: lead, text: t.trim(), n: i + 1 });
      });
      var pos = 0, seen = {}, answerType = null, soft = [];

      function softNote(it, reason) {
        soft.push({ line: it.n, text: it.text, reason: reason || "" });
        return mk("note", { i: { MSG: it.text } });
      }

      function kids(parentInd) {
        if (pos >= items.length || items[pos].ind <= parentInd) return [];
        var ind = items[pos].ind, out = [];
        while (pos < items.length && items[pos].ind >= ind) {
          if (items[pos].ind > ind) throw perr(items[pos].n, "this line is indented too far");
          var st = stmt(ind);
          if (st) out = out.concat(st);
        }
        return out;
      }

      function joinPrintArgs(args, line) {
        if (!args.length) return "";
        var acc = parseExpr(args[0], line, seen);
        for (var i = 1; i < args.length; i++) {
          acc = mk("op_join", { i: {
            A: mk("op_join", { i: { A: unstr(acc), B: " " } }),
            B: unstr(parseExpr(args[i], line, seen))
          } });
        }
        return unstr(acc);
      }

      function expandRangeFor(varName, args, body, line) {
        seen[varName] = 1;
        var stepBody;
        if (args.length === 1) {
          stepBody = body.concat([mk("change_var", { f: { VAR: varName }, i: { BY: "1" } })]);
          return [
            mk("set_var", { f: { VAR: varName }, i: { VAL: "0" } }),
            mk("repeat", { i: { N: parseExpr(args[0], line, seen) }, body: stepBody })
          ];
        }
        var from = parseExpr(args[0], line, seen);
        var to = parseExpr(args[1], line, seen);
        var step = args[2] != null ? parseExpr(args[2], line, seen) : "1";
        stepBody = body.concat([mk("change_var", { f: { VAR: varName }, i: { BY: unstr(step) } })]);
        return [
          mk("set_var", { f: { VAR: varName }, i: { VAL: unstr(from) } }),
          mk("repeat_until", {
            i: { COND: mk("op_ge", { i: { A: mk("var_get", { f: { VAR: varName } }), B: unstr(to) } }) },
            body: stepBody
          })
        ];
      }

      function stmt(ind) {
        var it = items[pos], t = it.text, m;
        if (/^(import|from|global|pass|nonlocal)\b/.test(t)) { pos++; return null; }

        // Hoist  if __name__ == "__main__":  so class scripts build cleanly
        if (/^if\s+__name__\s*==\s*(['"])__main__\1\s*:$/.test(t)) {
          pos++;
          return kids(ind);
        }

        // try / except / finally / else — keep bodies; mark headers as notes
        if (/^try\s*:$/.test(t)) {
          pos++;
          var tryBody = kids(ind);
          var outTry = tryBody.slice();
          while (pos < items.length && items[pos].ind === ind &&
                 /^(except\b|finally\s*:|else\s*:)/.test(items[pos].text)) {
            var hdr = items[pos];
            pos++;
            outTry.push(softNote(hdr, "try/except runs the try body; this branch is kept as a note"));
            outTry = outTry.concat(kids(ind));
          }
          return outTry;
        }

        if (/^if\b/.test(t) || /^elif\b/.test(t)) {
          var cond = t.replace(/^(if|elif)\s*/, "").replace(/:$/, "");
          if (!/:$/.test(it.text)) throw perr(it.n, "this if needs a colon at the end");
          pos++;
          var body = kids(ind);
          var nx = items[pos];
          if (nx && nx.ind === ind && /^elif\b/.test(nx.text)) {
            var inner = stmt(ind);                    // the elif becomes a nested if
            return mk("if_else", { i: { COND: parseExpr(cond, it.n, seen) }, body: body, body2: [inner] });
          }
          if (nx && nx.ind === ind && /^else\s*:$/.test(nx.text)) {
            pos++;
            var eb = kids(ind);
            return mk("if_else", { i: { COND: parseExpr(cond, it.n, seen) }, body: body, body2: eb });
          }
          return mk("if_then", { i: { COND: parseExpr(cond, it.n, seen) }, body: body });
        }

        if ((m = /^while\s+(.*):$/.exec(t))) {
          pos++;
          var b = kids(ind), c = m[1].trim();
          if (/^True$/.test(c)) return mk("forever", { body: b });
          var until;
          if (/^not\b/.test(c)) until = parseExpr(c.replace(/^not\s*/, ""), it.n, seen);
          else until = mk("op_not", { i: { A: parseExpr(c, it.n, seen) } });
          // "while not X: time.sleep(small)"  is a wait-until
          if (b.length === 1 && b[0].op === "wait" && parseFloat(b[0].inputs.SECS) <= 0.1)
            return mk("wait_until", { i: { COND: until } });
          return mk("repeat_until", { i: { COND: until }, body: b });
        }

        if ((m = /^for\s+(\w+)\s+in\s+range\((.*)\):$/.exec(t))) {
          pos++;
          var rargs = splitArgs(m[2]);
          return expandRangeFor(m[1], rargs, kids(ind), it.n);
        }

        if ((m = /^for\s+(\w+)\s+in\s+(.+):$/.exec(t))) {
          pos++;
          seen[m[1]] = 1;
          var listExpr = parseExpr(m[2].trim(), it.n, seen);
          return mk("for_each", {
            f: { VAR: m[1] },
            i: { LIST: unstr(listExpr) },
            body: kids(ind)
          });
        }

        if (/^break\b/.test(t)) { pos++; return mk("break_loop"); }
        if (/^continue\b/.test(t)) { pos++; return mk("continue_loop"); }

        if (/^raise\s+SystemExit\b/.test(t)) { pos++; return mk("stop_all", { f: { WHAT: "everything" } }); }
        if (/^#\s*End\b/i.test(t)) { pos++; return mk("end_script"); }
        if (/^return\b/.test(t)) { pos++; return mk("stop_all", { f: { WHAT: "this script" } }); }

        // class / with / async — soft notes with nested body
        if (/^(class|with|async\s+def|async\s+with)\b/.test(t)) {
          pos++;
          var skipped = kids(ind);
          return [softNote(it, "not a block — kept as a note")].concat(skipped);
        }

        var inner = matchCall(t, "print");
        if (inner !== null) {
          pos++;
          var pargs = splitArgs(inner).filter(function (a) { return a.indexOf("=") < 0; });
          return mk("say", { i: { MSG: joinPrintArgs(pargs, it.n) } });
        }

        inner = matchCall(t, "time.sleep");
        if (inner !== null) { pos++; return mk("wait", { i: { SECS: parseExpr(inner, it.n, seen) } }); }

        // Bare input("…") / input()  ->  ask block
        inner = matchCall(t, "input");
        if (inner !== null) {
          pos++;
          var bareQ = "";
          if (String(inner).trim()) {
            var bareQv = parseExpr(inner, it.n, seen);
            if (bareQv && typeof bareQv === "object" && (bareQv.op === "op_add" || bareQv.op === "op_join"))
              bareQv = bareQv.inputs.A;
            bareQ = litOf(bareQv);
            if (bareQ == null) bareQ = "";
          }
          return mk("ask", { i: { Q: bareQ } });
        }

        // list methods
        if ((m = /^([A-Za-z_]\w*)\.append\((.*)\)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("list_add", { f: { LIST: m[1] }, i: { ITEM: parseExpr(m[2], it.n, seen) } });
        }
        if ((m = /^([A-Za-z_]\w*)\.clear\(\s*\)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("list_delete_all", { f: { LIST: m[1] } });
        }
        if ((m = /^([A-Za-z_]\w*)\.insert\((.*)\)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          var iargs = splitArgs(m[2]);
          return mk("list_insert", {
            f: { LIST: m[1] },
            i: { INDEX: parseExpr(iargs[0] || "0", it.n, seen), ITEM: parseExpr(iargs[1] || '""', it.n, seen) }
          });
        }
        if ((m = /^([A-Za-z_]\w*)\.pop\((.*)\)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          var popIdx = String(m[2]).trim() === "" ? "-1" : m[2];
          return mk("list_delete", { f: { LIST: m[1] }, i: { INDEX: parseExpr(popIdx, it.n, seen) } });
        }
        if ((m = /^del\s+([A-Za-z_]\w*)\s*\[\s*(.+)\s*\]\s*$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("list_delete", { f: { LIST: m[1] }, i: { INDEX: parseExpr(m[2], it.n, seen) } });
        }

        // xs[i] = value
        if ((m = /^([A-Za-z_]\w*)\s*\[\s*(.+)\s*\]\s*=\s*(.+)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("list_replace", {
            f: { LIST: m[1] },
            i: { INDEX: parseExpr(m[2], it.n, seen), ITEM: parseExpr(m[3], it.n, seen) }
          });
        }

        if ((m = /^([A-Za-z_]\w*)\s*\+=\s*(.+)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("change_var", { f: { VAR: m[1] }, i: { BY: parseExpr(m[2], it.n, seen) } });
        }
        if ((m = /^([A-Za-z_]\w*)\s*-=\s*(.+)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("set_var", {
            f: { VAR: m[1] },
            i: { VAL: mk("op_sub", { i: { A: mk("var_get", { f: { VAR: m[1] } }), B: parseExpr(m[2], it.n, seen) } }) }
          });
        }
        if ((m = /^([A-Za-z_]\w*)\s*\*=\s*(.+)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("set_var", {
            f: { VAR: m[1] },
            i: { VAL: mk("op_mul", { i: { A: mk("var_get", { f: { VAR: m[1] } }), B: parseExpr(m[2], it.n, seen) } }) }
          });
        }
        if ((m = /^([A-Za-z_]\w*)\s*\/=\s*(.+)$/.exec(t))) {
          pos++; seen[m[1]] = 1;
          return mk("set_var", {
            f: { VAR: m[1] },
            i: { VAL: mk("op_div", { i: { A: mk("var_get", { f: { VAR: m[1] } }), B: parseExpr(m[2], it.n, seen) } }) }
          });
        }

        if ((m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t))) {
          var name = m[1], rhs = m[2].trim();
          pos++;
          if (/^time\.time\(\)$/.test(rhs)) return mk("reset_timer");
          var unwrapped = rhs, w, wrapType = null;
          if ((w = matchCall(rhs, "int")) !== null) { unwrapped = w; wrapType = "int"; }
          else if ((w = matchCall(rhs, "float")) !== null) { unwrapped = w; wrapType = "number"; }
          var q = matchCall(unwrapped, "input");
          if (q !== null) {
            var qt = "";
            if (String(q).trim()) {
              var qv = parseExpr(q, it.n, seen);
              if (qv && typeof qv === "object" && (qv.op === "op_add" || qv.op === "op_join"))
                qv = qv.inputs.A;
              qt = litOf(qv);
              if (qt == null) qt = "";
            }
            if (wrapType) answerType = wrapType;      // int(input(...)) means the box wants a number
            else if (!answerType) answerType = "text"; // plain input(...) accepts any text (names, etc.)
            var askBlk = mk("ask", { i: { Q: qt } });
            if (name === "answer") return askBlk;
            seen[name] = 1;                       // x = input(...)  ->  ask, then store it
            return [askBlk, mk("set_var", { f: { VAR: name }, i: { VAL: mk("answer") } })];
          }
          seen[name] = 1;
          try {
            return mk("set_var", { f: { VAR: name }, i: { VAL: parseExpr(rhs, it.n, seen) } });
          } catch (errExpr) {
            return softNote(it, errExpr.message);
          }
        }

        if ((m = /^([A-Za-z_]\w*)\s*\(\s*\)$/.exec(t))) {
          pos++;
          return mk("broadcast_w", { i: { MSG: m[1] } });
        }

        // Unknown statement → note block so the canvas still shows something
        pos++;
        return softNote(it, "no matching block — shown as a note");
      }

      // top level: plain statements make the green-flag script, defs become receivers
      var main = [], defs = [], m2;
      while (pos < items.length) {
        var it = items[pos];
        if (it.ind !== 0) throw perr(it.n, "this line is indented but nothing opens a block above it");
        if ((m2 = /^def\s+([A-Za-z_]\w*)\s*\(\s*\)\s*:$/.exec(it.text))) {
          var nm = m2[1]; pos++;
          defs.push({ name: nm, body: kids(0) });
        } else if ((m2 = /^def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:$/.exec(it.text))) {
          // def with args — keep body, note the header
          var dname = m2[1]; pos++;
          var dbody = [softNote(it, "functions with arguments become a broadcast receiver")].concat(kids(0));
          defs.push({ name: dname, body: dbody });
        } else {
          var st = stmt(0);
          if (st) main = main.concat(st);
        }
      }
      if (!main.length && !defs.length) throw perr(1, "there is no code to build here");

      var stacks = [];
      if (main.length) stacks.push({ id: sid(), x: 30, y: 20, blocks: [mk("when_flag")].concat(main) });
      defs.forEach(function (d, i) {
        var hat = /^on_/.test(d.name)
          ? mk("when_key", { f: { KEY: d.name.replace(/^on_/, "").replace(/_/g, " ") } })
          : mk("when_recv", { i: { MSG: d.name } });
        stacks.push({ id: sid(), x: 520, y: 20 + i * 220, blocks: [hat].concat(d.body) });
      });
      delete seen.answer; delete seen.start; delete seen._;
      delete seen.True; delete seen.False;
      return { stacks: stacks, vars: Object.keys(seen), answerType: answerType, soft: soft };
    }
  
    // --- the Build button ---
    var codeDirty = false;
    function codeMsg(text, ok) {
      var e = $("#codeerr");
      e.textContent = text || "";
      e.classList.toggle("on", !!text);
      e.classList.toggle("codeok", ok === true);
      e.classList.toggle("codewarn", ok === "warn");
      if (text) {
        try { e.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (err) {}
      }
    }
    function codeIsEmpty(src) {
      return !String(src || "")
        .split(/\r?\n/)
        .map(function (line) { return stripComment(line).trim(); })
        .some(Boolean);
    }
    $("#code").addEventListener("input", function () {
      codeDirty = true;
      this.classList.add("dirty");
      var wrap = this.closest(".codewrap");
      if (wrap) wrap.classList.add("has-dirty");
      codeMsg("");
    });
    $("#buildcode").onclick = function () {
      var src = $("#code").value;
      if (codeIsEmpty(src)) {
        codeMsg(
          "Type a Python script in the box, then press Build. Example:\n" +
          "answer = int(input(\"Enter a number\"))\n" +
          "print(answer)"
        );
        return;
      }
      var res;
      try {
        res = parsePython(src);
      } catch (err) {
        codeMsg((err.line ? "Line " + err.line + ": " : "") + err.message);
        return;
      }
      function stacksHaveAsk(stacks) {
        for (var si = 0; si < (stacks || []).length; si++) {
          var blks = stacks[si].blocks || [];
          for (var bi = 0; bi < blks.length; bi++) {
            if (blks[bi] && blks[bi].op === "ask") return true;
          }
        }
        return false;
      }
      snapshot();
      emptyCanvas = false;
      // Sync the answer-box rule with what the Python actually asks for.
      // Plain input() / ask → text (so names work). int()/float() → numeric.
      // Always apply so a stale int rule cannot stick after rebuilding a text script.
      if (res.answerType === "int" || res.answerType === "number") {
        concept.answer = Object.assign({}, concept.answer || {}, {
          type: res.answerType,
          fromBuild: true,
          fromEdit: false,
        });
      } else if (res.answerType === "text" || stacksHaveAsk(res.stacks)) {
        concept.answer = { type: "text" };
      }
      armAnswerBox(false);
      var added = res.vars.filter(function (v) { return concept.vars.indexOf(v) < 0; });
      if (added.length) {
        concept.vars = concept.vars.concat(added);
        buildPalette();
      }
      W = { stacks: res.stacks };
      pan.x = 40; pan.y = 30;
      select(null);
      codeDirty = false;
      $("#code").classList.remove("dirty");
      var cw = $("#code") && $("#code").closest ? $("#code").closest(".codewrap") : null;
      if (cw) cw.classList.remove("has-dirty");
      render();
      renderCode();                       // show it back in the app's own wording
      var n = 0;
      res.stacks.forEach(function (st) { n += st.blocks.length; });
      var msg = "Built " + n + " blocks on the canvas" +
        (added.length ? ", added variable " + added.join(", ") : "") + ".";
      if (res.soft && res.soft.length) {
        msg += "\n" + res.soft.length + " line(s) had no exact block match and became notes:";
        res.soft.slice(0, 6).forEach(function (s) {
          msg += "\n  L" + s.line + ": " + s.text;
        });
        if (res.soft.length > 6) msg += "\n  …";
      }
      codeMsg(msg, (res.soft && res.soft.length) ? "warn" : true);
      // On stacked/narrow layouts the canvas sits below the Python panel
      try { $("#wrap").scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (err2) {}
    };
  
    // ------------------------------------------------------------------ concepts UI
    function growBrief() {
      var t = $("#brief");
      t.style.height = "auto";
      t.style.height = Math.min(210, t.scrollHeight + 2) + "px";
    }
    $("#brief").addEventListener("input", function () {
      concept.brief = this.value;
      growBrief();
    });
    $("#btitle").addEventListener("input", function () {
      concept.title = this.value;
      var i = PRESETS.indexOf(concept);
      if (i > -1 && $("#concept").options[i]) $("#concept").options[i].textContent = this.value || "Untitled";
    });
  
    function loadConcept(c, keepWork) {
      concept = normalizeConceptAnswer(c);
      $("#brief").value = c.brief;
      $("#btitle").value = c.title;
      growBrief();
      clearConsole();
      armAnswerBox(false);
      showAnswerError("");
      if (!keepWork) select(null);
      if (!keepWork) {
        emptyCanvas = false;
        W = c.solution ? { stacks: [{ id: sid(), x: 30, y: 20, blocks: c.solution() }] } : { stacks: [] };
        pan.x = 40; pan.y = 30;
      }
      undo.length = 0;
      syncUndoBtn();
      resetVars();
      if (c.id === "model") tab = "model";
      buildTabs();
      buildPalette();
      render();
    }
  
    function fillPicker() {
      var sel = $("#concept");
      sel.innerHTML = "";
      PRESETS.forEach(function (p, i) {
        var o = document.createElement("option");
        o.value = String(i); o.textContent = p.title;
        sel.appendChild(o);
      });
    }
    $("#concept").onchange = function () {
      if (R.on) {
        R.stop = true;
        if (R.pending) { var p = R.pending; R.pending = null; p(""); }
        setRunning(false);
      }
      emptyCanvas = false;
      loadConcept(PRESETS[+this.value]);
    };
  
    $("#reset").onclick = async function () {
      var hasBlocks = !!W.stacks.length;
      if (typeof options.onReset === "function") {
        if (hasBlocks && !confirm("Reset workspace to defaults? All blocks will be cleared.")) return;
        try {
          if (R.on) {
            R.stop = true;
            if (R.pending) { var p = R.pending; R.pending = null; p(""); }
            setRunning(false);
          }
          var state = await options.onReset();
          if (state && typeof state === "object") {
            applyState(state);
            clearConsole();
            note("Workspace reset to defaults.", "");
            return;
          }
        } catch (err) {
          var msg = (err && err.message) ? String(err.message) : "Reset failed";
          note("Could not reset workspace: " + msg, "fail");
          return;
        }
      }
      if (!hasBlocks || confirm("Clear every block from the workspace?")) {
        snapshot(); W = { stacks: [] }; emptyCanvas = true; select(null);
        pruneConceptVarsToWorkspace();
        buildPalette();
        clearConsole(); resetVars(); render();
        if (typeof options.onSave === "function") options.onSave(getState());
      }
    };

    // Resizable palette + side panel (both ends of the canvas)
    (function wirePaneResizers() {
      var pal = $("#pal");
      var side = root.querySelector(".side");
      var splitPal = $("#rsplit-pal");
      var splitSide = $("#rsplit-side");
      if (!pal || !side || !splitPal || !splitSide) return;

      var STORE = "rbp-pane-widths";
      var LIMITS = {
        pal: { min: 180, max: 460, def: 250 },
        side: { min: 260, max: 560, def: 362 }
      };

      function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

      function readStore() {
        try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; }
        catch (e) { return {}; }
      }

      function writeStore(partial) {
        var cur = readStore();
        if (partial.pal != null) cur.pal = partial.pal;
        if (partial.side != null) cur.side = partial.side;
        try { localStorage.setItem(STORE, JSON.stringify(cur)); } catch (e) {}
      }

      function applyWidth(pane, which, px) {
        var lim = LIMITS[which];
        var w = clamp(Math.round(px), lim.min, lim.max);
        pane.style.width = w + "px";
        return w;
      }

      (function restore() {
        var saved = readStore();
        if (saved.pal) applyWidth(pal, "pal", saved.pal);
        if (saved.side) applyWidth(side, "side", saved.side);
      })();

      function bindSplit(split, pane, which, invert) {
        var lim = LIMITS[which];

        function startDrag(e) {
          if (e.button != null && e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          var startX = e.clientX;
          var startW = pane.getBoundingClientRect().width;
          split.classList.add("is-drag");
          root.classList.add("resizing");
          try { split.setPointerCapture(e.pointerId); } catch (err) {}

          function onMove(ev) {
            var dx = ev.clientX - startX;
            var next = invert ? startW - dx : startW + dx;
            applyWidth(pane, which, next);
          }
          function onUp(ev) {
            split.classList.remove("is-drag");
            root.classList.remove("resizing");
            try { split.releasePointerCapture(ev.pointerId); } catch (err2) {}
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onUp);
            var finalW = Math.round(pane.getBoundingClientRect().width);
            var patch = {};
            patch[which] = clamp(finalW, lim.min, lim.max);
            writeStore(patch);
          }
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
          document.addEventListener("pointercancel", onUp);
        }

        on(split, "pointerdown", startDrag);
        on(split, "keydown", function (e) {
          var step = e.shiftKey ? 24 : 12;
          var cur = pane.getBoundingClientRect().width;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            var wl = applyWidth(pane, which, invert ? cur + step : cur - step);
            var pl = {}; pl[which] = wl; writeStore(pl);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            var wr = applyWidth(pane, which, invert ? cur - step : cur + step);
            var pr = {}; pr[which] = wr; writeStore(pr);
          } else if (e.key === "Home") {
            e.preventDefault();
            var wh = applyWidth(pane, which, lim.def);
            var ph = {}; ph[which] = wh; writeStore(ph);
          }
        });
      }

      bindSplit(splitPal, pal, "pal", false);
      bindSplit(splitSide, side, "side", true);
    })();

    function fsElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }
    function paintFullscreenBtn() {
      var btn = $("#fullscreen");
      if (!btn) return;
      var on = fsElement() === root;
      btn.classList.toggle("is-fs", on);
      btn.title = on ? "Exit full screen" : "Full screen";
      btn.setAttribute("aria-label", btn.title);
    }
    if ($("#undoBtn")) {
      $("#undoBtn").onclick = function (e) {
        e.preventDefault();
        undoLast();
      };
    }
    if ($("#fullscreen")) {
      $("#fullscreen").onclick = function () {
        if (fsElement() === root) {
          var exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) try { exit.call(document); } catch (e1) {}
          return;
        }
        var req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!req) return;
        try {
          var p = req.call(root);
          if (p && typeof p.catch === "function") p.catch(function () {});
        } catch (e2) {}
      };
      on(document, "fullscreenchange", paintFullscreenBtn);
      on(document, "webkitfullscreenchange", paintFullscreenBtn);
      paintFullscreenBtn();
    }
  
    // concept editor
    function syncConceptInPresets() {
      if (!concept) return;
      var idx = PRESETS.indexOf(concept);
      if (idx < 0) {
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === concept.id) { idx = i; break; }
        }
      }
      if (idx > -1) PRESETS[idx] = concept;
    }

    $("#edit").onclick = function () {
      $("#f-title").value = concept.title;
      $("#f-brief").value = concept.brief;
      $("#f-vars").value = concept.vars.join(", ");
      var a = rule();
      $("#f-atype").value = a.type || "text";
      $("#f-amin").value = a.min == null ? "" : a.min;
      $("#f-amax").value = a.max == null ? "" : a.max;
      $("#veil").classList.add("on");
      setTimeout(function () { $("#f-title").focus(); }, 20);
    };
    $("#dlg-x").onclick = function () { $("#veil").classList.remove("on"); };
    $("#veil").addEventListener("pointerdown", function (e) {
      if (e.target === $("#veil")) $("#veil").classList.remove("on");
    });
    $("#dlg-ok").onclick = function () {
      var vars = $("#f-vars").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var ans = { type: $("#f-atype").value, fromEdit: true };
      var lo = $("#f-amin").value.trim(), hi = $("#f-amax").value.trim();
      if (ans.type !== "text") {
        if (lo !== "" && isNum(lo)) ans.min = parseFloat(lo);
        if (hi !== "" && isNum(hi)) ans.max = parseFloat(hi);
        if (ans.min != null && ans.max != null && ans.min > ans.max) {
          var sw = ans.min; ans.min = ans.max; ans.max = sw;
        }
      } else {
        ans = { type: "text", fromEdit: true };
      }
      var idx = PRESETS.indexOf(concept);
      var c = {
        // Keep the current concept id so built-ins keep their solution on reload
        id: (concept && concept.id) ? concept.id : ("custom" + Date.now()),
        title: $("#f-title").value.trim() || "Untitled concept",
        brief: $("#f-brief").value,
        vars: vars.length ? vars : ["Answer"],
        answer: ans,
        tests: [],
      };
      if (concept && concept.solution) c.solution = concept.solution;
      if (idx > -1) PRESETS[idx] = c; else PRESETS.push(c);
      fillPicker();
      $("#concept").value = String(PRESETS.indexOf(c));
      $("#veil").classList.remove("on");
      loadConcept(c, true);
    };
  
    // ------------------------------------------------------------------ boot
    function serializeConcept(c) {
      return {
        id: c.id,
        title: c.title || "",
        brief: c.brief || "",
        vars: (c.vars || []).slice(),
        answer: c.answer ? JSON.parse(JSON.stringify(c.answer)) : { type: "text" },
        tests: [],
      };
    }

    function getState() {
      return {
        version: 1,
        pan: { x: pan.x, y: pan.y },
        zoom: zoom,
        active_concept_id: concept ? concept.id : null,
        concepts: PRESETS.map(serializeConcept),
        stacks: JSON.parse(JSON.stringify(W.stacks)),
        empty_canvas: emptyCanvas && W.stacks.length === 0,
        // saved after the Machine Learning blocks were available (see the start-up check below)
        ml_ready: mlReady || undefined,
      };
    }

    function applyState(state) {
      if (!state) return;
      if (state.concepts && state.concepts.length) {
        PRESETS = state.concepts.map(function (c) {
          return normalizeConceptTitle({
            id: c.id,
            title: c.title || "Untitled",
            brief: c.brief || "",
            vars: (c.vars && c.vars.length) ? c.vars.slice() : ["Answer"],
            answer: c.answer || { type: "text" },
            tests: [],
            solution: BUILTIN_SOLUTIONS[c.id],
          });
        });
      }
      // Older saves may lack the Ask-the-model concept — keep the starter available
      if (!findPresetById("model") && BUILTIN_SOLUTIONS.model) {
        var modelConcept = {
          id: "model",
          title: "Ask the model",
          vars: ["Input", "Answer"],
          answer: { type: "text" },
          brief: "Ask any question, send it to the model, then say the reply.\n\n" +
                 "Flow: ask the student \u2192 store Input \u2192 ask the model \u2192 store Answer from prediction \u2192 say it.\n\n" +
                 "Press Run, type any question, and the model answers.",
          tests: [],
          solution: BUILTIN_SOLUTIONS.model,
        };
        var blankAt = -1;
        for (var mi = 0; mi < PRESETS.length; mi++) {
          if (PRESETS[mi].id === "blank") { blankAt = mi; break; }
        }
        if (blankAt > -1) PRESETS.splice(blankAt, 0, modelConcept);
        else PRESETS.push(modelConcept);
      }
      if (state.pan) {
        pan.x = Number(state.pan.x) || 40;
        pan.y = Number(state.pan.y) || 30;
      }
      if (state.zoom != null) zoom = clampZoom(Number(state.zoom) || 1);
      else zoom = 1;
      W = { stacks: Array.isArray(state.stacks) ? JSON.parse(JSON.stringify(state.stacks)) : [] };
      emptyCanvas = !!state.empty_canvas && W.stacks.length === 0;
      undo.length = 0;
      syncUndoBtn();
      selId = null;
      fillPicker();
      var idx = 0;
      if (state.active_concept_id) {
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === state.active_concept_id) { idx = i; break; }
        }
      }
      $("#concept").value = String(idx);
      // Keep saved stacks (including intentionally empty canvases)
      loadConcept(PRESETS[idx], W.stacks.length > 0 || emptyCanvas);
      clearConsole();
      armAnswerBox(false);
      showAnswerError("");
      resetVars();
      select(null);
      render();
    }

    // A workspace saved before the model was trained has no Machine Learning blocks: the first
    // time the trained model is here, open on the Text recognition starter instead.
    if (options.initialState && !(mlReady && !options.initialState.ml_ready)) {
      applyState(options.initialState);
    } else {
      fillPicker();
      loadConcept(PRESETS[0]);
    }
    on(window, "resize", function () { BL.paint(world); });

    if ($("#save")) {
      $("#save").onclick = function () {
        if (typeof options.onSave === "function") options.onSave(getState());
      };
    }

  return {
    cleanup: function cleanup() {
      cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
      try { if (R && R.on) R.stop = true; } catch (e) {}
    },
    getState: getState,
    applyState: applyState,
    // Harness-only hooks (production UI does not call these).
    _test: {
      runScript: runScript,
      getConcept: function () { return concept; },
      getPresets: function () { return PRESETS.slice(); },
      loadConceptAt: function (i, keep) { loadConcept(PRESETS[i], keep); },
      getZoom: function () { return zoom; },
      setZoom: setZoom,
      setTab: function (cat) { tab = cat; buildTabs(); buildPalette(); },
      getTab: function () { return tab; },
      selectBlock: function (id) { select(id); },
      findEmptyCondCount: function () { return findEmptyCondBlocks().length; },
      getCoachText: function () {
        var el = $("#blkcoach");
        return el && el.classList.contains("on") ? (el.textContent || "") : "";
      },
      getPaletteSections: function () {
        return Array.prototype.map.call($("#palbody").querySelectorAll(".palsec"), function (el) {
          return el.textContent;
        });
      },
      getPaletteOpOrder: function () {
        return Array.prototype.map.call($("#palbody").querySelectorAll(".blk"), function (el) {
          var id = el.dataset.id;
          var m = palModels[id];
          return m ? m.op : null;
        }).filter(Boolean);
      },
      getWarnedUnset: function () { return Object.keys(R.warnedUnset || {}); },
      getPan: function () { return { x: pan.x, y: pan.y }; },
    },
  };
}
