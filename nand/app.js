/* Logic Gate Builder — vanilla JS, SVG + DOM, live simulation, localStorage.
 *
 * Model
 *   library : map of gate definitions (reusable building blocks)
 *             - primitive: AND, NOT  (evaluated by a JS function)
 *             - custom   : has an internal `circuit` snapshot, evaluated recursively
 *   state   : the circuit currently on the canvas
 *             { title, inputs[], outputs[], gates[], wires[] }
 *
 * A "port" is referenced by { owner, side, index }:
 *   - owner = id of an input node, output node, or placed gate
 *   - side  = 'out' (a signal source) | 'in' (a signal sink)
 *   - index = which port on that owner (0-based, top to bottom)
 *
 * A wire = { id, from: <out-port ref>, to: <in-port ref> }.
 */
(function () {
  'use strict';

  // ---- constants / geometry -------------------------------------------------
  var GATE_H   = 46;
  var STUB     = 26;   // distance from a node's big circle to its port dot
  var EDGE     = 0;    // io circle sits on the canvas border (straddles it, like gate ports)
  var COLORS   = ['#6a3fd0', '#1f8a70', '#c1742f', '#b03a6e', '#3f7fd0', '#7a9a2b'];

  function inputName(i)  { return String.fromCharCode(65 + (i % 26)); }   // A, B, C…
  function outputName(i) { return i === 0 ? 'Out' : 'Out' + (i + 1); }

  // ---- gate library ---------------------------------------------------------
  var library = {
    AND: { name: 'AND', type: 'primitive', color: '#2f7fc1', inputs: 2, outputs: 1 },
    NOT: { name: 'NOT', type: 'primitive', color: '#8a2b34', inputs: 1, outputs: 1 }
  };

  // ---- live canvas state ----------------------------------------------------
  var uid = 0;
  function nextId(prefix) { uid += 1; return prefix + uid; }

  // An input/output is a GROUP of bit-members. A group has one member by default;
  // more members can be added (the group is a multi-bit bus -> a decimal value).
  function newInputGroup(name)  { return { id: nextId('ig'), name: name, members: [{ id: nextId('in'),  value: 0 }] }; }
  function newOutputGroup(name) { return { id: nextId('og'), name: name, members: [{ id: nextId('out') }] }; }

  function freshState() {
    return {
      title: '',
      inputs:  [ newInputGroup(inputName(0)), newInputGroup(inputName(1)) ],
      outputs: [ newOutputGroup(outputName(0)) ],
      gates:   [],
      wires:   []
    };
  }

  // The simulator/wiring work at the bit-member level; groups are an editing concept.
  function flatInputs()  { return state.inputs.reduce(function (a, g) { return a.concat(g.members); }, []); }
  function flatOutputs() { return state.outputs.reduce(function (a, g) { return a.concat(g.members); }, []); }
  function circuitOf()   { return { inputs: flatInputs(), outputs: flatOutputs(), gates: state.gates, wires: state.wires }; }

  var state = freshState();   // call only after uid + nextId are initialized
  var selected = null;        // id of selected gate

  // ---- challenges -----------------------------------------------------------
  // Each scenario asks the user to build a gate from the primitives (and any
  // gates they've already created). `fn(bits)` is the target truth table:
  // given the input bits (top-to-bottom = bits[0..n]), it returns the expected
  // output bits. "Check" runs every input combination through the canvas and,
  // if it matches, snapshots the canvas into a reusable gate of that name.
  var SCENARIOS = [
    { name: 'NAND', inputs: 2, outputs: 1, hint: 'NOT (A AND B) — true unless both inputs are on.',
      fn: function (b) { return [ (b[0] && b[1]) ? 0 : 1 ]; } },
    { name: 'OR',   inputs: 2, outputs: 1, hint: 'A OR B — De Morgan: NOT(NOT A AND NOT B).',
      fn: function (b) { return [ (b[0] || b[1]) ? 1 : 0 ]; } },
    { name: 'XOR',  inputs: 2, outputs: 1, hint: 'A XOR B — on only when the inputs differ.',
      fn: function (b) { return [ (b[0] !== b[1]) ? 1 : 0 ]; } },
    { name: 'ADDER', inputs: 3, outputs: 2, outNames: ['SUM', 'Carry'],
      hint: '1-bit full adder. Inputs A, B, C (carry-in). Top output = SUM (A⊕B⊕C), bottom = Carry-out.',
      fn: function (b) {
        var a = b[0], bb = b[1], c = b[2];
        var sum  = a ^ bb ^ c;                 // 1 when an odd number of inputs are on
        var cout = (a & bb) | (a & c) | (bb & c); // majority of the three inputs
        return [ sum ? 1 : 0, cout ? 1 : 0 ];
      } }
  ];
  var chMsg = {};             // scenario name -> { ok, text } feedback shown in the panel

  // ---- DOM refs -------------------------------------------------------------
  var canvasEl   = document.getElementById('canvas');
  var svgEl      = document.getElementById('wires');
  var nodesEl    = document.getElementById('nodes');
  var gateListEl = document.getElementById('gate-list');
  var createBtn  = document.getElementById('create-btn');
  var resetBtn   = document.getElementById('reset-btn');
  var titleEl    = document.getElementById('title');
  var truthEl    = document.getElementById('truth');
  var chListEl   = document.getElementById('ch-list');

  // ===========================================================================
  //  SIMULATION
  // ===========================================================================
  function pkey(ref) { return ref.owner + '|' + ref.side + '|' + ref.index; }

  function applyGate(def, ins) {
    if (def.type === 'primitive') {
      if (def.name === 'AND') return [ins.every(function (v) { return v === 1; }) ? 1 : 0];
      if (def.name === 'NOT') return [ins[0] ? 0 : 1];
      return [0];
    }
    // custom gate: evaluate its internal circuit recursively
    return evaluateCircuit(def.circuit, ins).outputs;
  }

  // Feed-forward evaluation of a circuit given its input values.
  function evaluateCircuit(circuit, inputValues) {
    var val = {};                         // portKey -> 0/1
    var wireFrom = {};                    // sinkKey -> source ref
    circuit.wires.forEach(function (w) { wireFrom[pkey(w.to)] = w.from; });

    circuit.inputs.forEach(function (inp, i) {
      val[pkey({ owner: inp.id, side: 'out', index: 0 })] = inputValues[i] ? 1 : 0;
    });

    function srcVal(sinkRef) {            // value arriving at an input-side port
      var from = wireFrom[pkey(sinkRef)];
      if (!from) return 0;               // unconnected sink reads 0
      var k = pkey(from);
      return (k in val) ? val[k] : null; // null = source not resolved yet
    }

    var pending = circuit.gates.slice();
    var guard = pending.length + 2;
    while (pending.length && guard-- > 0) {
      var still = [];
      pending.forEach(function (g) {
        var def = library[g.def];
        var ins = [], ready = true;
        for (var i = 0; i < def.inputs; i++) {
          var v = srcVal({ owner: g.id, side: 'in', index: i });
          if (v === null) { ready = false; break; }
          ins.push(v);
        }
        if (!ready) { still.push(g); return; }
        var outs = applyGate(def, ins);
        for (var j = 0; j < def.outputs; j++)
          val[pkey({ owner: g.id, side: 'out', index: j })] = outs[j] ? 1 : 0;
      });
      // stuck (dangling / cycle): force unknown inputs to 0 and finish
      if (still.length === pending.length) {
        still.forEach(function (g) {
          var def = library[g.def], ins = [];
          for (var i = 0; i < def.inputs; i++) {
            var v = srcVal({ owner: g.id, side: 'in', index: i });
            ins.push(v === null ? 0 : v);
          }
          var outs = applyGate(def, ins);
          for (var j = 0; j < def.outputs; j++)
            val[pkey({ owner: g.id, side: 'out', index: j })] = outs[j] ? 1 : 0;
        });
        still = [];
      }
      pending = still;
    }

    var outputs = circuit.outputs.map(function (o) {
      var v = srcVal({ owner: o.id, side: 'in', index: 0 });
      return v === null ? 0 : v;
    });
    var wireVals = circuit.wires.map(function (w) {
      var k = pkey(w.from);
      return (k in val) ? val[k] : 0;
    });
    return { outputs: outputs, val: val, wireVals: wireVals };
  }

  // ===========================================================================
  //  LAYOUT  (positions are derived, so adding/removing nodes redistributes)
  // ===========================================================================
  function gateWidth(def) { return Math.max(54, def.name.length * 9 + 22); }
  function portY(i, n) { return GATE_H * (i + 1) / (n + 1); }

  var MEMBER_GAP = 40;   // vertical gap between members within a group

  // lay out a column of groups: group centers spread evenly across H, members clustered per group
  function columnLayout(groups, H) {
    var ys = {}, span = {}, n = groups.length;
    groups.forEach(function (g, k) {
      var center = H * (k + 1) / (n + 1);
      var blockH = (g.members.length - 1) * MEMBER_GAP;
      var startY = center - blockH / 2;
      g.members.forEach(function (m, i) { ys[m.id] = startY + i * MEMBER_GAP; });
      span[g.id] = { top: startY, bottom: startY + blockH, mid: center };
    });
    return { ys: ys, span: span };
  }

  function layout() {
    var W = canvasEl.clientWidth, H = canvasEl.clientHeight;
    var ci = columnLayout(state.inputs, H), co = columnLayout(state.outputs, H);
    return {
      W: W, H: H,
      inX: EDGE, inPortX: EDGE + STUB,
      outX: W - EDGE, outPortX: W - EDGE - STUB,
      inputY: ci.ys, outputY: co.ys,
      inSpan: ci.span, outSpan: co.span
    };
  }

  // canvas-space coordinates of any port
  function portXY(ref, L) {
    if (ref.owner.indexOf('in') === 0 && L.inputY[ref.owner] !== undefined)
      return { x: L.inPortX, y: L.inputY[ref.owner] };
    if (ref.owner.indexOf('out') === 0 && L.outputY[ref.owner] !== undefined)
      return { x: L.outPortX, y: L.outputY[ref.owner] };
    var g = findGate(ref.owner);
    var def = library[g.def], w = gateWidth(def);
    if (ref.side === 'in')  return { x: g.x,     y: g.y + portY(ref.index, def.inputs) };
    return { x: g.x + w, y: g.y + portY(ref.index, def.outputs) };
  }

  function findGate(id) {
    for (var i = 0; i < state.gates.length; i++)
      if (state.gates[i].id === id) return state.gates[i];
    return null;
  }

  // ===========================================================================
  //  RENDER
  // ===========================================================================
  var SVGNS = 'http://www.w3.org/2000/svg';

  function wirePath(a, b) {
    var dx = Math.max(30, Math.abs(b.x - a.x) * 0.4);
    return 'M ' + a.x + ' ' + a.y +
           ' C ' + (a.x + dx) + ' ' + a.y + ', ' +
                   (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
  }

  function render() {
    var L = layout();
    var fin = flatInputs(), fout = flatOutputs();
    var sim = evaluateCircuit(circuitOf(), fin.map(function (m) { return m.value; }));
    var outVal = {};                                   // member id -> 0/1
    fout.forEach(function (m, i) { outVal[m.id] = sim.outputs[i]; });

    // ---- SVG: stubs + wires ----
    var svg = '';
    fin.forEach(function (m) {
      svg += line(L.inX, L.inputY[m.id], L.inPortX, L.inputY[m.id], 'var(--wire-off)', 2);
    });
    fout.forEach(function (m) {
      svg += line(L.outPortX, L.outputY[m.id], L.outX, L.outputY[m.id], 'var(--wire-off)', 2);
    });
    state.wires.forEach(function (w, i) {
      var a = portXY(w.from, L), b = portXY(w.to, L);
      var on = sim.wireVals[i] === 1;
      svg += '<path class="wire" data-wire="' + w.id + '" d="' + wirePath(a, b) + '" ' +
             'fill="none" stroke="' + (on ? 'var(--wire-on)' : 'var(--wire-off)') +
             '" stroke-width="' + (on ? 3 : 2) + '" />';
    });
    svgEl.innerHTML = svg;

    // ---- HTML nodes: gates + io ----
    var html = '';

    state.gates.forEach(function (g) {
      var def = library[g.def], w = gateWidth(def);
      html += '<div class="gate' + (selected === g.id ? ' selected' : '') + '" data-gate="' + g.id +
              '" style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + w + 'px;background:' + def.color + '">' +
              esc(def.name);
      for (var i = 0; i < def.inputs; i++)
        html += port(g.id, 'in', i, 0, portY(i, def.inputs));
      for (var j = 0; j < def.outputs; j++)
        html += port(g.id, 'out', j, w, portY(j, def.outputs));
      html += '</div>';
    });

    state.inputs.forEach(function (g) {
      html += groupName(g, L.inX, L.inSpan[g.id], 'in');
      g.members.forEach(function (m) {
        var y = L.inputY[m.id];
        html += '<div class="io in' + (m.value ? ' on' : '') + '" data-toggle="' + m.id +
                '" style="left:' + L.inX + 'px;top:' + y + 'px"></div>';
        html += freePort(m.id, 'out', 0, L.inPortX, y);
      });
      html += groupCtrls(g, L.inX, L.inSpan[g.id], 'in');
      if (g.members.length > 1)
        html += groupDecimal('in', L.inX, L.inSpan[g.id].mid, groupValue(g, function (m) { return m.value; }));
    });
    state.outputs.forEach(function (g) {
      html += groupName(g, L.outX, L.outSpan[g.id], 'out');
      html += groupCtrls(g, L.outX, L.outSpan[g.id], 'out');
      if (g.members.length > 1)
        html += groupDecimal('out', L.outX, L.outSpan[g.id].mid, groupValue(g, function (m) { return outVal[m.id]; }));
      g.members.forEach(function (m) {
        var y = L.outputY[m.id], on = outVal[m.id] === 1;
        html += '<div class="io' + (on ? ' on' : '') + '" style="left:' + L.outX + 'px;top:' + y + 'px"></div>';
        html += freePort(m.id, 'in', 0, L.outPortX, y);
      });
    });

    nodesEl.innerHTML = html;
    titleEl.value = state.title;
    renderTruthTable();
    renderChallenges();
  }

  // editable group name, above the group's members
  function groupName(g, cx, span, side) {
    var PAD = 10;
    var left = side === 'in' ? (cx + PAD) : (cx - PAD);
    return '<div class="grp-head ' + side + '" style="left:' + left + 'px;top:' + (span.top - 30) + 'px">' +
           '<input class="grp-name" data-name-for="' + g.id + '" spellcheck="false" value="' + esc(g.name || '') + '" />' +
           '</div>';
  }
  // decimal value of a group's bits (top member = most-significant bit)
  function groupValue(g, valueOf) {
    var n = g.members.length, v = 0;
    g.members.forEach(function (m, i) { v += (valueOf(m) ? 1 : 0) * Math.pow(2, n - 1 - i); });
    return v;
  }
  // decimal badge in the outer margin (left of inputs / right of outputs)
  function groupDecimal(side, cx, mid, value) {
    var left = side === 'in' ? (cx - 16) : (cx + 16);
    var tf   = side === 'in' ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
    return '<div class="grp-dec" style="left:' + left + 'px;top:' + mid + 'px;transform:' + tf + '">' + value + '</div>';
  }

  // add/remove-member controls, below the group's members (where a new member appears)
  function groupCtrls(g, cx, span, side) {
    var PAD = 10;
    var left = side === 'in' ? (cx + PAD) : (cx - PAD);
    return '<div class="grp-head ' + side + '" style="left:' + left + 'px;top:' + (span.bottom + 28) + 'px">' +
           '<span class="grp-ctrl">' +
             '<button data-group-act="del-member" data-group="' + g.id + '" title="Remove bit">−</button>' +
             '<button data-group-act="add-member" data-group="' + g.id + '" title="Add bit">+</button>' +
           '</span></div>';
  }
  function port(owner, side, index, left, top) {
    return '<div class="port" data-owner="' + owner + '" data-side="' + side + '" data-index="' + index +
           '" style="left:' + left + 'px;top:' + top + 'px"></div>';
  }
  function freePort(owner, side, index, x, y) {  // absolutely placed in the nodes layer
    return '<div class="port" data-owner="' + owner + '" data-side="' + side + '" data-index="' + index +
           '" style="left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%)"></div>';
  }
  function line(x1, y1, x2, y2, stroke, w) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
           '" stroke="' + stroke + '" stroke-width="' + w + '" />';
  }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function renderToolbar() {
    gateListEl.innerHTML = Object.keys(library).map(function (name) {
      var def = library[name];
      return '<span class="tool palette" data-palette="' + name + '" title="Drag onto the canvas">' +
             '<span class="sw" style="background:' + def.color + '"></span>' + esc(name) + '</span>';
    }).join('');
  }

  // ===========================================================================
  //  INTERACTION
  // ===========================================================================
  function canvasPoint(e) {
    var r = canvasEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvasEl.addEventListener('pointerdown', function (e) {
    if (e.target.closest('input, button')) return;   // name field or group control — let its click fire, don't re-render
    var portEl = e.target.closest('[data-port], .port');
    if (portEl && portEl.classList.contains('port')) { startWire(portEl, e); return; }
    var gateEl = e.target.closest('[data-gate]');
    if (gateEl) { startGateDrag(gateEl.getAttribute('data-gate'), e); return; }
    if (!e.target.closest('[data-toggle]')) { selected = null; render(); }
  });

  // edit input/output names (no re-render while typing, so the field keeps focus)
  nodesEl.addEventListener('input', function (e) {
    var f = e.target.closest('[data-name-for]');
    if (!f) return;
    var id = f.getAttribute('data-name-for');
    var grp = state.inputs.concat(state.outputs).find(function (x) { return x.id === id; });
    if (grp) { grp.name = f.value; renderTruthTable(); }   // update headers live (table is separate DOM, keeps field focus)
  });

  // find a group by id and which side it is on
  function findGroup(id) {
    var g = state.inputs.find(function (x) { return x.id === id; });
    if (g) return { group: g, isInput: true };
    g = state.outputs.find(function (x) { return x.id === id; });
    if (g) return { group: g, isInput: false };
    return null;
  }

  // add / remove a bit-member within a group
  function groupAction(id, act) {
    var f = findGroup(id);
    if (!f) return;
    if (act === 'add-member') {
      f.group.members.push(f.isInput ? { id: nextId('in'), value: 0 } : { id: nextId('out') });
    } else if (act === 'del-member' && f.group.members.length > 1) {
      removeWiresFor(f.group.members.pop().id);
    }
    render();
  }

  function removeWiresFor(ownerId) {
    state.wires = state.wires.filter(function (w) { return w.from.owner !== ownerId && w.to.owner !== ownerId; });
  }
  function removeGroup(g) { g.members.forEach(function (m) { removeWiresFor(m.id); }); }

  // clicks: group member +/-, toggle inputs, delete wires
  canvasEl.addEventListener('click', function (e) {
    var gb = e.target.closest('[data-group-act]');
    if (gb) { groupAction(gb.getAttribute('data-group'), gb.getAttribute('data-group-act')); return; }

    var tog = e.target.closest('[data-toggle]');
    if (tog) {
      var m = flatInputs().find(function (x) { return x.id === tog.getAttribute('data-toggle'); });
      if (m) { m.value = m.value ? 0 : 1; render(); }
      return;
    }
    var wire = e.target.closest('[data-wire]');
    if (wire) {
      var id = wire.getAttribute('data-wire');
      state.wires = state.wires.filter(function (w) { return w.id !== id; });
      render();
    }
  });

  titleEl.addEventListener('input', function () { state.title = titleEl.value; });

  document.getElementById('io-controls').addEventListener('click', function (e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    if (act === 'add-in')  state.inputs.push(newInputGroup(inputName(state.inputs.length)));
    if (act === 'add-out') state.outputs.push(newOutputGroup(outputName(state.outputs.length)));
    if (act === 'del-in'  && state.inputs.length  > 1) removeGroup(state.inputs.pop());
    if (act === 'del-out' && state.outputs.length > 1) removeGroup(state.outputs.pop());
    render();
  });

  gateListEl.addEventListener('pointerdown', function (e) {
    var pal = e.target.closest('[data-palette]');
    if (pal) { startPaletteDrag(pal.getAttribute('data-palette'), e); return; }
  });
  createBtn.addEventListener('click', createGate);
  resetBtn.addEventListener('click', resetProgress);

  // delete selected gate
  window.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement !== titleEl) {
      removeNode(selected);
      selected = null;
      render();
    }
  });

  function removeNode(id) {
    state.gates = state.gates.filter(function (g) { return g.id !== id; });
    state.wires = state.wires.filter(function (w) { return w.from.owner !== id && w.to.owner !== id; });
  }

  // ---- drag: move an existing gate -----------------------------------------
  function startGateDrag(id, e) {
    var g = findGate(id), start = canvasPoint(e);
    var off = { x: start.x - g.x, y: start.y - g.y }, moved = false;
    drag(e, function (ev) {
      var p = canvasPoint(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 4) moved = true;
      if (moved) { g.x = p.x - off.x; g.y = p.y - off.y; render(); }
    }, function () {
      selected = moved ? null : id;   // a click (no move) selects
      render();
    });
  }

  // ---- drag: spawn a gate from the palette ----------------------------------
  function startPaletteDrag(name, e) {
    var def = library[name], w = gateWidth(def);
    var ghost = document.createElement('div');
    ghost.className = 'gate ghost';
    ghost.style.width = w + 'px'; ghost.style.height = GATE_H + 'px';
    ghost.style.background = def.color; ghost.textContent = name;
    document.body.appendChild(ghost);
    var place = function (ev) {
      ghost.style.left = (ev.clientX - w / 2) + 'px';
      ghost.style.top  = (ev.clientY - GATE_H / 2) + 'px';
    };
    place(e);
    drag(e, place, function (ev) {
      document.body.removeChild(ghost);
      var r = canvasEl.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
        var p = canvasPoint(ev);
        state.gates.push({ id: nextId('g'), def: name, x: p.x - w / 2, y: p.y - GATE_H / 2 });
        render();
      }
    });
  }

  // ---- drag: draw a wire ----------------------------------------------------
  function startWire(portEl, e) {
    var startRef = refOf(portEl);
    var L = layout(), a = portXY(startRef, L);
    var temp = document.createElementNS(SVGNS, 'path');
    temp.setAttribute('fill', 'none');
    temp.setAttribute('stroke', 'var(--hot)');
    temp.setAttribute('stroke-width', '2');
    temp.setAttribute('stroke-dasharray', '5 4');
    svgEl.appendChild(temp);

    drag(e, function (ev) {
      var p = canvasPoint(ev);
      temp.setAttribute('d', wirePath(a, p));
    }, function (ev) {
      svgEl.removeChild(temp);
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var dst = el && el.closest('.port');
      if (dst) addWire(startRef, refOf(dst));
      render();
    });
  }

  function refOf(portEl) {
    return {
      owner: portEl.getAttribute('data-owner'),
      side:  portEl.getAttribute('data-side'),
      index: parseInt(portEl.getAttribute('data-index'), 10)
    };
  }

  // connect an 'out' port to an 'in' port (order-independent)
  function addWire(a, b) {
    var from, to;
    if (a.side === 'out' && b.side === 'in') { from = a; to = b; }
    else if (a.side === 'in' && b.side === 'out') { from = b; to = a; }
    else return;                                   // need exactly one of each
    if (from.owner === to.owner) return;
    state.wires = state.wires.filter(function (w) {  // single fan-in per sink
      return pkey(w.to) !== pkey(to);
    });
    state.wires.push({ id: nextId('w'), from: from, to: to });
  }

  // generic pointer-drag helper
  function drag(e, onMove, onUp) {
    e.preventDefault();
    function move(ev) { onMove(ev); }
    function up(ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onUp(ev);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ===========================================================================
  //  CREATE GATE  (snapshot current canvas -> reusable definition)
  // ===========================================================================
  // snapshot the current canvas into a reusable custom-gate definition.
  // a created gate is a black box of bit-ports; groups don't carry into the definition.
  function makeDef(name) {
    var L = layout();
    var sortByY = function (members, yMap) {
      return members.slice().sort(function (a, b) { return yMap[a.id] - yMap[b.id]; });
    };
    var inputs  = sortByY(flatInputs(),  L.inputY ).map(function (m) { return { id: m.id }; });
    var outputs = sortByY(flatOutputs(), L.outputY).map(function (m) { return { id: m.id }; });
    return {
      name: name,
      type: 'custom',
      color: COLORS[customCount() % COLORS.length],
      inputs:  inputs.length,
      outputs: outputs.length,
      circuit: {
        inputs:  inputs,
        outputs: outputs,
        gates:   state.gates.map(function (g) { return { id: g.id, def: g.def, x: g.x, y: g.y }; }),
        wires:   state.wires.map(function (w) { return { from: w.from, to: w.to }; })
      }
    };
  }

  function createGate() {
    var name = state.title.trim().toUpperCase();
    if (!name) { flashTitle(); return; }
    if (library[name] && library[name].type === 'primitive') {
      alert('"' + name + '" is a built-in gate name. Choose another.');
      return;
    }
    if (state.gates.length === 0) { alert('Add and wire some gates first.'); return; }

    library[name] = makeDef(name);
    persist();
    state = freshState();
    selected = null;
    renderToolbar();
    render();
  }

  function customCount() {
    return Object.keys(library).filter(function (k) { return library[k].type === 'custom'; }).length;
  }
  function flashTitle() {
    titleEl.focus();
    titleEl.style.transition = 'none';
    titleEl.style.color = 'var(--hot)';
    setTimeout(function () { titleEl.style.color = ''; }, 250);
  }

  // ===========================================================================
  //  CHALLENGES  (build a target gate from the primitives, verify, then keep it)
  // ===========================================================================
  // a scenario is "solved" once a custom gate of that name exists in the library
  function isSolved(name) { return !!(library[name] && library[name].type === 'custom'); }
  // a scenario unlocks only after every earlier scenario is solved
  function isUnlocked(i) {
    for (var k = 0; k < i; k++) if (!isSolved(SCENARIOS[k].name)) return false;
    return true;
  }
  function indexOfScenario(name) {
    for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].name === name) return i;
    return -1;
  }
  // the challenge currently being worked on: first unlocked-but-unsolved scenario
  function activeChallenge() {
    for (var i = 0; i < SCENARIOS.length; i++)
      if (isUnlocked(i) && !isSolved(SCENARIOS[i].name)) return SCENARIOS[i];
    return null;
  }
  var compareOff = false;   // session toggle: show the plain truth table instead of the diff

  function chFeedback(name, ok, text) { chMsg[name] = { ok: ok, text: text }; renderChallenges(); }

  // run every input combination through the canvas and compare to the target;
  // on a full match, snapshot the canvas as a reusable gate of the scenario's name.
  function checkScenario(name) {
    var idx = indexOfScenario(name);
    if (idx < 0 || !isUnlocked(idx)) return;   // ignore locked / unknown
    var sc = SCENARIOS[idx];

    var bits = function (n) { return n + ' ' + (n === 1 ? 'bit' : 'bits'); };
    var fin = flatInputs(), fout = flatOutputs();
    if (state.gates.length === 0)
      return chFeedback(name, false, 'Add and wire some gates first.');
    if (fin.length !== sc.inputs)
      return chFeedback(name, false, 'Needs exactly ' + bits(sc.inputs) + ' of input (you have ' + fin.length + ').');
    if (fout.length !== sc.outputs)
      return chFeedback(name, false, 'Needs exactly ' + bits(sc.outputs) + ' of output (you have ' + fout.length + ').');

    var total = Math.pow(2, sc.inputs);
    for (var m = 0; m < total; m++) {
      var combo = [];
      for (var i = 0; i < sc.inputs; i++) combo.push((m >> (sc.inputs - 1 - i)) & 1);   // first input = MSB
      var got  = evaluateCircuit(circuitOf(), combo).outputs;
      var want = sc.fn(combo);
      for (var j = 0; j < sc.outputs; j++) {
        if ((got[j] ? 1 : 0) !== (want[j] ? 1 : 0)) {
          var label = (sc.outNames && sc.outNames[j]) ? sc.outNames[j]
                    : (sc.outputs > 1 ? 'output #' + (j + 1) : 'output');
          return chFeedback(name, false,
            'Not yet — for inputs ' + combo.join(', ') + ', ' + label +
            ' gives ' + (got[j] ? 1 : 0) + ', expected ' + (want[j] ? 1 : 0) + '.');
        }
      }
    }

    // passed: store the gate, clear the canvas for the next build
    library[name] = makeDef(name);
    persist();
    chMsg[name] = { ok: true, text: 'Solved! ' + name + ' is now in your palette.' };
    state = freshState();
    selected = null;
    renderToolbar();
    render();   // also refreshes the open challenges panel
  }

  // wipe custom gates + progress, leaving only the AND / NOT primitives
  function resetProgress() {
    if (!window.confirm('Delete all custom gates and challenge progress? AND and NOT will remain.')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    Object.keys(library).forEach(function (k) {
      if (library[k].type !== 'primitive') delete library[k];
    });
    chMsg = {};
    state = freshState();
    selected = null;
    renderToolbar();
    render();
  }

  // compact checklist; the active row (first unlocked, unsolved) is expanded
  // with its hint, Check button, and last feedback. solved rows offer Rebuild.
  function renderChallenges() {
    chListEl.innerHTML = SCENARIOS.map(function (sc, i) {
      var done = isSolved(sc.name);
      var unlocked = isUnlocked(i);
      var active = unlocked && !done;                 // sequential -> at most one active
      var cls = done ? 'done' : (active ? 'active' : 'locked');
      var status = done ? '✓' : (active ? '○' : '🔒');
      var action = done
        ? '<button class="ch-check" data-check="' + sc.name + '">Rebuild</button>'
        : (active ? '<button class="ch-check" data-check="' + sc.name + '">Check</button>' : '');
      var msg = chMsg[sc.name];
      return '<div class="ch-row ' + cls + '">' +
               '<div class="ch-row-top">' +
                 '<span class="ch-status">' + status + '</span>' +
                 '<span class="ch-name">' + esc(sc.name) + '</span>' +
                 action +
               '</div>' +
               (active ? '<div class="ch-hint">' + esc(sc.hint) + '</div>' : '') +
               (active && msg ? '<div class="ch-msg ' + (msg.ok ? 'ok' : 'err') + '">' + esc(msg.text) + '</div>' : '') +
             '</div>';
    }).join('');
  }

  chListEl.addEventListener('click', function (e) {
    var c = e.target.closest('[data-check]');
    if (c) checkScenario(c.getAttribute('data-check'));
  });

  // ===========================================================================
  //  PERSISTENCE
  // ===========================================================================
  var LS_KEY = 'logicgates.custom.v1';
  function persist() {
    var customs = Object.keys(library)
      .filter(function (k) { return library[k].type === 'custom'; })
      .map(function (k) { return library[k]; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(customs)); } catch (e) {}
  }
  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      JSON.parse(raw).forEach(function (def) { library[def.name] = def; });
    } catch (e) {}
  }

  // ===========================================================================
  //  TRUTH TABLE  (every input combination evaluated through the simulator)
  // ===========================================================================
  var TT_MAX_INPUTS = 10;   // 2^10 = 1024 rows; beyond this we just show a note

  // one column per bit-member; multi-member groups suffix the bit index (A0, A1…)
  function memberCols(groups) {
    var cols = [];
    groups.forEach(function (g) {
      g.members.forEach(function (m, i) {
        cols.push(g.members.length > 1 ? (g.name || '') + i : (g.name || ''));
      });
    });
    return cols;
  }

  function renderTruthTable() {
    var n = flatInputs().length;
    if (n > TT_MAX_INPUTS) {
      truthEl.innerHTML = '<div class="tt-note">Too many inputs to tabulate (max ' + TT_MAX_INPUTS + ' bits).</div>';
      return;
    }
    // diff against the active challenge: compare each output bit to its target.
    var sc = activeChallenge();
    var nOut = flatOutputs().length;
    var fits = sc && sc.inputs === n && sc.outputs === nOut;   // shapes line up -> can compare
    var comparing = !!fits && !compareOff;

    var cols = memberCols(state.inputs).concat(memberCols(state.outputs));
    var head = '<tr>' + cols.map(function (name) { return '<th>' + esc(name) + '</th>'; }).join('') + '</tr>';

    var body = '', matches = 0;
    var total = Math.pow(2, n);
    for (var m = 0; m < total; m++) {
      var combo = [];
      for (var i = 0; i < n; i++) combo.push((m >> (n - 1 - i)) & 1);   // first input bit = most-significant
      var outs = evaluateCircuit(circuitOf(), combo).outputs;
      var want = comparing ? sc.fn(combo) : null;
      var rowOk = true;
      var outCells = '';
      for (var j = 0; j < outs.length; j++) {
        var v = outs[j] ? 1 : 0;
        if (comparing && v !== (want[j] ? 1 : 0)) {
          rowOk = false;
          outCells += '<td class="v' + v + ' tt-bad" title="expected ' + (want[j] ? 1 : 0) + '">' +
                      v + '<span class="tt-want">' + (want[j] ? 1 : 0) + '</span></td>';
        } else {
          outCells += '<td class="v' + v + '">' + v + '</td>';
        }
      }
      if (comparing && rowOk) matches++;
      body += '<tr>' +
        combo.map(function (cv) { return '<td class="v' + cv + '">' + cv + '</td>'; }).join('') +
        outCells + '</tr>';
    }

    truthEl.innerHTML = compareBar(sc, comparing, matches, total, n, nOut) +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  // status strip above the table: live match count, shape hint, or a paused toggle
  function compareBar(sc, comparing, matches, total, n, nOut) {
    if (!sc) return '';
    if (comparing) {
      var ok = matches === total;
      return '<div class="tt-bar' + (ok ? ' ok' : '') + '">' +
               '<span>' + esc(sc.name) + ' &middot; ' + matches + ' / ' + total + (ok ? ' ✓' : '') + '</span>' +
               '<button data-tt="cmp-off" title="Show the plain table">Plain</button>' +
             '</div>';
    }
    if (compareOff) {
      return '<div class="tt-bar">' +
               '<span>Comparison paused</span>' +
               '<button data-tt="cmp-on" title="Compare against ' + esc(sc.name) + '">Compare ' + esc(sc.name) + '</button>' +
             '</div>';
    }
    // unlocked challenge but the canvas shape doesn't match yet
    var needIn  = sc.inputs  + ' input'  + (sc.inputs  === 1 ? '' : 's');
    var needOut = sc.outputs + ' output' + (sc.outputs === 1 ? '' : 's');
    return '<div class="tt-bar">' +
             '<span>For ' + esc(sc.name) + ', use ' + needIn + ' &amp; ' + needOut +
             ' (you have ' + n + ' / ' + nOut + ').</span>' +
           '</div>';
  }

  // pause / resume the challenge diff inside the always-on truth table
  truthEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tt]');
    if (!b) return;
    compareOff = b.getAttribute('data-tt') === 'cmp-off';
    renderTruthTable();
  });

  // ===========================================================================
  //  THEME  (Auto / Light / Dark — Auto follows the OS via CSS media query)
  // ===========================================================================
  var THEME_KEY = 'logicgates.theme';
  var themeBar = document.getElementById('theme-bar');

  function applyTheme(t) {
    if (t !== 'light' && t !== 'dark') t = 'system';
    document.documentElement.setAttribute('data-theme', t);
    Array.prototype.forEach.call(themeBar.children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-theme-opt') === t);
    });
  }

  themeBar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-opt]');
    if (!b) return;
    var t = b.getAttribute('data-theme-opt');
    try { localStorage.setItem(THEME_KEY, t); } catch (err) {}
    applyTheme(t);
  });

  function restoreTheme() {
    var t;
    try { t = localStorage.getItem(THEME_KEY); } catch (err) {}
    applyTheme(t || 'system');
  }

  // ===========================================================================
  //  BOOT
  // ===========================================================================
  restoreTheme();
  restore();
  renderToolbar();
  render();

  // Re-render whenever the canvas is actually sized. A ResizeObserver fires
  // once right after the first layout (fixing a stale first-paint size) and on
  // every later resize — more reliable than waiting for window 'resize'.
  if (window.ResizeObserver) {
    new ResizeObserver(function () { render(); }).observe(canvasEl);
  } else {
    window.addEventListener('resize', render);
  }
})();
