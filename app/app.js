/* Kitchen site app, shared by every person's page.
   Each page sets window.KITCHEN = { person: "erin", root: "../" } before loading this file.
   Data: library/recipes.json (every recipe), people/<person>.json (their sections and box),
   site.json (the helper's address). The box holds this person's own tags, notes and made history. */
(function () {
  var CFG = window.KITCHEN || {};
  var ROOT = CFG.root || './';
  var PERSON = CFG.person;
  var LABEL = { chicken: 'Chicken', beef: 'Beef', pork: 'Pork', seafood: 'Seafood', eggs: 'Eggs', meatless: 'Meatless' };
  var CONF = { likely: 'Likely', guess: 'Best guess' };
  var CONF_NOTE = { likely: "Likely: I'm fairly sure this is the dish, but not certain.", guess: "Best guess: the photo doesn't show enough to be sure." };
  var PRON = {
    she: { poss: 'Her', subj: 'she', made: "She's made it", notMade: "Hasn't made it", d: "she'd" },
    he: { poss: 'His', subj: 'he', made: "He's made it", notMade: "Hasn't made it", d: "he'd" },
    they: { poss: 'Their', subj: 'they', made: "They've made it", notMade: "Haven't made it", d: "they'd" }
  };
  var GROUPS = ['status', 'protein', 'slow', 'cozy', 'tag'];
  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), viewer = $('viewer'), adder = $('adder'), results = $('results'), qEl = $('q');
  var person = null, site = {}, library = [], recipes = [], sections = [], byId = {}, pron = PRON.they;
  var sel = { status: [], protein: [], slow: [], cozy: [], tag: [] };
  var mode = 'box';
  var query = '';
  var listScroll = 0, openedFromList = false, current = null;
  var PASS_KEY = 'ek-pass-' + PERSON;

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function forget(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text) { var b = el('button', cls, text); b.type = 'button'; return b; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fmtDate(d) { d = typeof d === 'string' ? new Date(d + 'T12:00:00') : d; return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function getJSON(path) {
    return fetch(ROOT + path, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
  }

  /* ---------- Data ---------- */
  function boxEntry(id) { return person.box.filter(function (b) { return b.id === id; })[0]; }
  function sectionById(id) { return person.sections.filter(function (s) { return s.id === id; })[0]; }
  function allTags() {
    var seen = {}, out = [];
    (person.tags || []).concat.apply(person.tags || [], person.box.map(function (b) { return b.tags || []; }))
      .forEach(function (t) { var k = norm(t); if (!seen[k]) { seen[k] = 1; out.push(t); } });
    return out;
  }
  function merge() {
    var order = {};
    person.box.forEach(function (b, i) { order[b.id] = i; });
    recipes = library.map(function (lr) {
      var b = boxEntry(lr.id);
      var r = Object.assign({}, lr);
      r.inBox = !!b;
      r.entry = b || null;
      r.made = b ? b.made.count : 0;
      r.myTags = b ? b.tags : [];
      r.myNote = b ? b.note : '';
      r.section = b ? b.section : null;
      r.confidence = b ? (b.confidence || 'clear') : 'clear';
      r.blurb = b && b.blurb ? b.blurb : (lr.credit ? 'From ' + lr.credit + '.' : '');
      r._order = b ? order[lr.id] : 1e6;
      return r;
    });
    byId = {};
    recipes.forEach(function (r) {
      byId[r.id] = r;
      var sec = r.section ? sectionById(r.section) : null;
      r._hay = norm([r.title, r.blurb, r.myNote, r.myTags.join(' '), sec ? sec.title : '', r.credit || '',
        r.proteins.map(function (p) { return LABEL[p]; }).join(' '),
        r.slowCooker ? 'slow cooker crockpot' : '', r.cozy ? 'warm cozy fall' : '', r.made ? 'made it' : '',
        r.ingredients.map(function (g) { return (g.group || '') + ' ' + g.items.join(' '); }).join(' '),
        (r.equipment || []).join(' ')].join(' '));
    });
  }
  function inView(r) { return mode === 'library' || r.inBox; }

  /* ---------- Filters ---------- */
  function values(r, g) {
    if (g === 'status') return [r.made ? 'made' : 'notmade'];
    if (g === 'protein') return r.proteins;
    if (g === 'slow') return r.slowCooker ? ['on'] : [];
    if (g === 'cozy') return r.cozy ? ['on'] : [];
    return r.myTags.map(norm);
  }
  function inGroup(r, g) {
    if (!sel[g].length) return true;
    var v = values(r, g);
    return sel[g].some(function (x) { return v.indexOf(x) !== -1; });
  }
  function matchesQuery(r) {
    if (!query) return true;
    return query.split(/\s+/).every(function (w) { return r._hay.indexOf(w) !== -1; });
  }
  function matches(r, skip) {
    return inView(r) && matchesQuery(r) && GROUPS.every(function (g) { return g === skip || inGroup(r, g); });
  }

  /* ---------- Rendering ---------- */
  function madeLabel(n) { return n === 1 ? 'Made once' : 'Made ' + n + '×'; }
  function tagsFor(r, opts) {
    var t = el('div', 'tags');
    if (r.made) t.appendChild(el('span', 'tag made', madeLabel(r.made)));
    if (opts && opts.showBox && r.inBox) t.appendChild(el('span', 'tag inbox', 'In ' + person.name + "'s box"));
    r.myTags.forEach(function (x) { t.appendChild(el('span', 'tag mine', x)); });
    r.proteins.forEach(function (p) { t.appendChild(el('span', 'tag', LABEL[p])); });
    if (r.slowCooker) t.appendChild(el('span', 'tag warm', 'Slow cooker'));
    if (r.cozy) t.appendChild(el('span', 'tag warm', 'Warm & cozy'));
    if (CONF[r.confidence]) t.appendChild(el('span', 'tag conf', CONF[r.confidence]));
    return t;
  }
  function metaFor(r) { return [r.total, r.servings].filter(Boolean).join(' · '); }
  function kindLabel(kind) {
    if (kind === 'photos') return 'From ' + pron.poss.toLowerCase() + ' photos';
    if (kind === 'ideas') return 'Ideas to try';
    return pron.poss + ' recipe box';
  }
  function blurbLabel(r) {
    var sec = r.section ? sectionById(r.section) : null;
    if (sec && sec.kind === 'photos') return 'In ' + pron.poss.toLowerCase() + ' photos';
    if (sec && sec.kind === 'ideas') return 'Why ' + pron.d + ' like it';
    return 'About this recipe';
  }

  function renderHeader() {
    document.title = person.title;
    $('title').textContent = person.title;
    $('handle').textContent = person.handle ? 'From ' + person.handle : 'Recipe box';
    var av = $('avatar');
    if (person.avatar) { av.src = ROOT + person.avatar; av.alt = person.avatarAlt || ''; av.hidden = false; }
    var inBox = recipes.filter(function (r) { return r.inBox; });
    var made = inBox.filter(function (r) { return r.made; });
    var stats = [
      [inBox.length, 'recipes in ' + pron.poss.toLowerCase() + ' box'],
      [made.length, 'made at least once'],
      [made.reduce(function (n, r) { return n + r.made; }, 0), 'times cooked'],
      [library.length, 'recipes in the whole library']
    ];
    var s = $('stats'); s.textContent = '';
    stats.forEach(function (x) { var d = el('div'); d.appendChild(el('b', null, String(x[0]))); d.appendChild(el('span', null, x[1])); s.appendChild(d); });
    $('updated').textContent = person.updated ? 'Updated ' + fmtDate(person.updated) : '';
    document.querySelector('.fchip[data-value="made"]').firstChild.textContent = pron.made + ' ';
    document.querySelector('.fchip[data-value="notmade"]').firstChild.textContent = pron.notMade + ' ';
    renderTagChips();
    renderTabs();
  }

  function renderTabs() {
    var nb = recipes.filter(function (r) { return r.inBox; }).length;
    $('tab-box').textContent = pron.poss + ' box (' + nb + ')';
    $('tab-library').textContent = 'Whole library (' + library.length + ')';
    $('tab-box').setAttribute('aria-pressed', String(mode === 'box'));
    $('tab-library').setAttribute('aria-pressed', String(mode === 'library'));
  }

  function renderTagChips() {
    var g = $('tag-group'), tags = allTags();
    g.querySelectorAll('.fchip').forEach(function (c) { c.remove(); });
    g.hidden = !tags.length;
    tags.forEach(function (t) {
      var b = btn('fchip mine', t + ' ');
      b.setAttribute('data-group', 'tag'); b.setAttribute('data-value', norm(t)); b.setAttribute('aria-pressed', 'false');
      b.appendChild(el('span', 'n'));
      g.appendChild(b);
    });
    sel.tag = sel.tag.filter(function (v) { return tags.some(function (t) { return norm(t) === v; }); });
  }

  function card(r) {
    var a = el('a', 'card'); a.href = '#r-' + r.id; r._card = a;
    var top = el('div', 'card-top'); top.appendChild(el('h3', null, r.title)); top.appendChild(el('span', 'meta', metaFor(r)));
    a.appendChild(top); a.appendChild(tagsFor(r, { showBox: mode === 'library' }));
    if (r.myNote) a.appendChild(el('p', 'cnote mine', r.myNote));
    else if (r.blurb) a.appendChild(el('p', 'cnote', r.blurb));
    a.appendChild(el('span', 'open', 'Open recipe →'));
    return a;
  }

  function renderList() {
    results.textContent = '';
    recipes.forEach(function (r) { r._card = null; });
    if (mode === 'library') {
      var sec = el('section', 'rsection');
      var head = el('div', 'section-head');
      head.appendChild(el('span', 'eyebrow', 'Whole library'));
      head.appendChild(el('h2', null, 'Every recipe, A to Z'));
      head.appendChild(el('p', null, "Recipes from everyone's boxes and everything added to the library. Nothing here is ever deleted. Open one to add it to " + person.name + "'s box."));
      sec.appendChild(head);
      var grid = el('div', 'cards');
      recipes.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (r) { grid.appendChild(card(r)); });
      sec.appendChild(grid); results.appendChild(sec);
      return;
    }
    var boxed = recipes.filter(function (r) { return r.inBox; }).sort(function (a, b) { return a._order - b._order; });
    if (!boxed.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('p', null, pron.poss + ' box is empty so far. Open the whole library and add recipes, or add a new one.'));
      var go = btn(null, 'Browse the whole library');
      go.addEventListener('click', function () { setMode('library'); });
      empty.appendChild(go);
      results.appendChild(empty);
      return;
    }
    var kinds = {}, counts = {};
    person.sections.forEach(function (s) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
    person.sections.forEach(function (s) {
      var inSec = boxed.filter(function (r) { return r.section === s.id; });
      if (!inSec.length) return;
      counts[s.kind] = (counts[s.kind] || 0) + 1;
      var sec = el('section', 'rsection'); sec.id = 's-' + s.id;
      var head = el('div', 'section-head');
      head.appendChild(el('span', 'eyebrow', kindLabel(s.kind)));
      head.appendChild(el('h2', null, s.title));
      if (s.intro) head.appendChild(el('p', null, s.intro));
      sec.appendChild(head);
      var grid = el('div', 'cards');
      inSec.forEach(function (r) { grid.appendChild(card(r)); });
      sec.appendChild(grid); results.appendChild(sec);
    });
  }

  function chips() { return Array.prototype.slice.call(document.querySelectorAll('.fchip')); }
  function apply() {
    var shown = 0, total = recipes.filter(inView).length;
    recipes.forEach(function (r) { var ok = matches(r); if (r._card) r._card.hidden = !ok; if (ok) shown++; });
    results.querySelectorAll('.rsection').forEach(function (s) { s.hidden = !s.querySelector('.card:not([hidden])'); });
    var filtered = !!query || GROUPS.some(function (g) { return sel[g].length; });
    var about = $('about'); if (about) about.hidden = filtered || mode === 'library';
    chips().forEach(function (b) {
      var g = b.getAttribute('data-group'), v = b.getAttribute('data-value');
      var on = sel[g].indexOf(v) !== -1;
      b.setAttribute('aria-pressed', String(on));
      var n = recipes.filter(function (r) { return matches(r, g) && values(r, g).indexOf(v) !== -1; }).length;
      b.querySelector('.n').textContent = n;
      b.disabled = !on && n === 0;
    });
    $('count').textContent = filtered ? shown + ' of ' + total + ' recipes' : total + ' recipes';
    $('clear').hidden = !filtered;
    $('empty').hidden = shown > 0 || !total;
    store('ek-filters-' + PERSON, sel);
  }
  function setMode(m) {
    mode = m; store('ek-mode-' + PERSON, m);
    renderTabs(); renderList(); apply();
  }
  function refresh() { merge(); renderHeader(); renderList(); apply(); }

  document.querySelector('.finder').addEventListener('click', function (e) {
    var b = e.target.closest('.fchip');
    if (!b) return;
    var g = b.getAttribute('data-group'), v = b.getAttribute('data-value');
    var i = sel[g].indexOf(v);
    if (i === -1) sel[g].push(v); else sel[g].splice(i, 1);
    apply();
  });
  $('tab-box').addEventListener('click', function () { setMode('box'); });
  $('tab-library').addEventListener('click', function () { setMode('library'); });
  qEl.addEventListener('input', function () { query = norm(qEl.value.trim()); apply(); });
  function clearAll() { GROUPS.forEach(function (g) { sel[g] = []; }); qEl.value = ''; query = ''; apply(); }
  $('clear').addEventListener('click', clearAll);
  $('reset').addEventListener('click', clearAll);
  results.addEventListener('click', function (e) { if (e.target.closest('.card')) { listScroll = window.scrollY; openedFromList = true; } });
  $('add-open').addEventListener('click', function () { listScroll = window.scrollY; openedFromList = true; });

  /* ---------- Helper calls (passcode remembered per person, per device) ---------- */
  function helper(path, body) {
    if (!site.worker) return Promise.reject(Object.assign(new Error("Changes aren't switched on yet. The helper still needs to be set up (see SETUP.md)."), { status: 0 }));
    return fetch(site.worker.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || ('The helper answered ' + res.status + '.')); e.status = res.status; throw e; }
        return j;
      });
    });
  }
  // A passcode field that only shows when this device doesn't know the passcode yet.
  function passRow(parent) {
    var f = el('div', 'field passrow');
    var id = 'pass-' + Math.random().toString(36).slice(2, 8);
    var l = el('label', null, person.name + "'s passcode"); l.htmlFor = id;
    var i = el('input'); i.type = 'password'; i.id = id; i.autocomplete = 'current-password';
    f.appendChild(l); f.appendChild(i);
    f.appendChild(el('span', 'hint', 'Needed once on this device to make changes.'));
    f.hidden = !!load(PASS_KEY);
    parent.appendChild(f);
    return {
      get: function () { return load(PASS_KEY) || i.value.trim(); },
      ok: function () { if (!load(PASS_KEY) && i.value.trim()) store(PASS_KEY, i.value.trim()); f.hidden = true; },
      bad: function () { forget(PASS_KEY); f.hidden = false; i.value = ''; i.focus(); },
      need: function () { if (!this.get()) { f.hidden = false; i.focus(); return true; } return false; }
    };
  }
  function errText(e) { return e.message || "That didn't go through. Check your connection and try again."; }

  /* ---------- Recipe body (recipe view and add preview) ---------- */
  function renderRecipeBody(r, body, opts) {
    var interactive = opts.interactive;
    var saved = interactive ? (load('ek-check-' + r.id) || { i: [], s: [] }) : { i: [], s: [] };
    function save() { if (interactive) store('ek-check-' + r.id, saved); }
    body.appendChild(el(opts.headingTag || 'h1', 'vtitle', r.title));
    body.appendChild(tagsFor(r));
    var facts = [['Serves', r.servings], ['Prep', r.prep], ['Cook', r.cook], ['Total', r.total]].filter(function (f) { return f[1]; });
    if (facts.length) {
      var fg = el('dl', 'vfacts');
      facts.forEach(function (f) { var d = el('div'); d.appendChild(el('dt', null, f[0])); d.appendChild(el('dd', null, f[1])); fg.appendChild(d); });
      body.appendChild(fg);
    }
    if (opts.panel) opts.panel(body);
    if (r.blurb) {
      var note = el('p', 'vnote');
      note.appendChild(el('b', null, blurbLabel(r)));
      note.appendChild(document.createTextNode(r.blurb));
      if (CONF_NOTE[r.confidence]) note.appendChild(el('span', 'conf', CONF_NOTE[r.confidence]));
      body.appendChild(note);
    }
    if (r.equipment && r.equipment.length) {
      var eh = el('div', 'vhead'); eh.appendChild(el('h2', null, 'Equipment')); body.appendChild(eh);
      var eq = el('ul', 'vequip'); r.equipment.forEach(function (x) { eq.appendChild(el('li', null, x)); }); body.appendChild(eq);
    }
    var nItems = r.ingredients.reduce(function (n, g) { return n + g.items.length; }, 0);
    var ih = el('div', 'vhead'); ih.appendChild(el('h2', null, 'Ingredients (' + nItems + ')'));
    var resetBtn = null;
    if (interactive) { resetBtn = btn(null, 'Uncheck all'); ih.appendChild(resetBtn); }
    body.appendChild(ih);
    var idx = 0, boxes = [];
    r.ingredients.forEach(function (g) {
      if (g.group) body.appendChild(el('h3', 'vgroup', g.group));
      var ul = el('ul', 'checks');
      g.items.forEach(function (it) {
        var k = idx++;
        var li = el('li'), lab = el('label'), cb = el('input');
        cb.type = 'checkbox'; cb.checked = saved.i.indexOf(k) !== -1; boxes.push(cb);
        if (!interactive) cb.disabled = true;
        cb.addEventListener('change', function () {
          saved.i = saved.i.filter(function (x) { return x !== k; }); if (cb.checked) saved.i.push(k); save();
        });
        lab.appendChild(cb); lab.appendChild(el('span', null, it)); li.appendChild(lab); ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    var sh = el('div', 'vhead'); sh.appendChild(el('h2', null, 'Steps')); body.appendChild(sh);
    var ol = el('ol', 'vsteps'), stepBtns = [];
    r.steps.forEach(function (t, k) {
      var li = el('li'), b = btn('step');
      b.setAttribute('aria-pressed', String(saved.s.indexOf(k) !== -1));
      b.appendChild(el('span', 'num', String(k + 1))); b.appendChild(el('span', 'txt', t));
      if (interactive) b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on));
        saved.s = saved.s.filter(function (x) { return x !== k; }); if (on) saved.s.push(k); save();
      });
      stepBtns.push(b); li.appendChild(b); ol.appendChild(li);
    });
    body.appendChild(ol);
    if (r.tips && r.tips.length) {
      var tb = el('div', 'vbox'); tb.appendChild(el('h3', null, 'Tips'));
      var tl = el('ul'); r.tips.forEach(function (x) { tl.appendChild(el('li', null, x)); }); tb.appendChild(tl);
      body.appendChild(tb);
    }
    if (r.storage) {
      var sb = el('div', 'vbox'); sb.appendChild(el('h3', null, 'Leftovers')); sb.appendChild(el('p', null, r.storage));
      body.appendChild(sb);
    }
    if (r.credit) body.appendChild(el('p', 'vcredit', 'Source: ' + r.credit));
    if (interactive) {
      body.appendChild(el('p', 'vhint', 'Tap an ingredient or a step to check it off. Your checkmarks stay on this device until you uncheck them.'));
      resetBtn.addEventListener('click', function () {
        saved = { i: [], s: [] }; save();
        boxes.forEach(function (c) { c.checked = false; });
        stepBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      });
    }
  }

  /* ---------- "My box" panel inside a recipe ---------- */
  function boxPanel(r) {
    return function (body) {
      var panel = el('section', 'mybox');
      panel.setAttribute('aria-label', person.name + "'s box");
      body.appendChild(panel);
      draw();

      function act(op, extra, statusEl, done) {
        if (pass.need()) { statusEl.className = 'status error'; statusEl.textContent = 'Enter the passcode first.'; return; }
        statusEl.className = 'status'; statusEl.textContent = 'Saving…';
        helper('/box', Object.assign({ passcode: pass.get(), person: PERSON, id: r.id, op: op }, extra || {}))
          .then(function (j) {
            pass.ok();
            person.box = person.box.filter(function (b) { return b.id !== r.id; });
            if (j.entry) {
              var at = person.box.length;
              if (r.entry) { var old = r._order; at = Math.min(old, person.box.length); }
              person.box.splice(at, 0, j.entry);
            }
            if (j.updated) person.updated = j.updated;
            refresh();
            r = byId[r.id];
            if (done) done();
            draw();
          })
          .catch(function (e) {
            if (e.status === 401) pass.bad();
            statusEl.className = 'status error'; statusEl.textContent = errText(e);
          });
      }

      var pass;
      function draw() {
        panel.textContent = '';
        var head = el('div', 'mybox-head');
        head.appendChild(el('h2', null, person.name + "'s box"));
        panel.appendChild(head);
        var status = el('p', 'status'); status.setAttribute('aria-live', 'polite');

        if (!r.inBox) {
          panel.appendChild(el('p', null, 'This recipe is in the whole library but not in ' + person.name + "'s box."));
          var f = el('div', 'field');
          var sid = 'sec-' + r.id;
          var l = el('label', null, 'Section'); l.htmlFor = sid;
          var s = el('select'); s.id = sid;
          person.sections.forEach(function (x) { var o = el('option', null, x.title); o.value = x.id; s.appendChild(o); });
          f.appendChild(l); f.appendChild(s); panel.appendChild(f);
          pass = passRow(panel);
          var addB = btn('btn primary', 'Add to ' + person.name + "'s box");
          addB.addEventListener('click', function () { act('add', { section: s.value }, status); });
          var row = el('div', 'btn-row'); row.appendChild(addB); panel.appendChild(row);
          panel.appendChild(status);
          return;
        }

        var e = r.entry;
        var madeLine = e.made.count ? madeLabel(e.made.count) + (e.made.log.length ? ' · last ' + e.made.log[e.made.log.length - 1] : '') : 'Not made yet';
        panel.appendChild(el('p', 'mybox-made', madeLine));

        pass = passRow(panel);

        var row1 = el('div', 'btn-row');
        var madeB = btn('btn primary', 'Made it today');
        madeB.addEventListener('click', function () { act('made', { date: fmtDate(new Date()) }, status); });
        row1.appendChild(madeB);
        if (e.made.count) {
          var undo = btn('btn', 'Undo last');
          undo.addEventListener('click', function () { act('unmade', null, status); });
          row1.appendChild(undo);
        }
        panel.appendChild(row1);

        // Tags
        var tf = el('div', 'field');
        tf.appendChild(el('span', 'flabel-lg', 'Tags'));
        var tagsWrap = el('div', 'tags editable');
        (e.tags || []).forEach(function (t) {
          var c = el('span', 'tag mine', t + ' ');
          var x = btn('tagx', '×'); x.setAttribute('aria-label', 'Remove tag ' + t);
          x.addEventListener('click', function () { act('tags', { tags: e.tags.filter(function (y) { return y !== t; }) }, status); });
          c.appendChild(x); tagsWrap.appendChild(c);
        });
        if (!e.tags.length) tagsWrap.appendChild(el('span', 'hint', 'No tags yet.'));
        tf.appendChild(tagsWrap);
        var suggestions = allTags().filter(function (t) { return !e.tags.some(function (y) { return norm(y) === norm(t); }); });
        if (suggestions.length) {
          var sug = el('div', 'tags');
          suggestions.forEach(function (t) {
            var b = btn('tag add', '+ ' + t);
            b.addEventListener('click', function () { act('tags', { tags: e.tags.concat([t]) }, status); });
            sug.appendChild(b);
          });
          tf.appendChild(sug);
        }
        var nt = el('div', 'inline');
        var tid = 'tag-' + r.id;
        var ti = el('input'); ti.type = 'text'; ti.id = tid; ti.placeholder = 'New tag, like date night'; ti.maxLength = 30;
        ti.setAttribute('aria-label', 'New tag');
        var tb = btn('btn', 'Add tag');
        function addTag() { var v = ti.value.trim(); if (!v) { ti.focus(); return; } act('tags', { tags: e.tags.concat([v]) }, status); }
        tb.addEventListener('click', addTag);
        ti.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addTag(); } });
        nt.appendChild(ti); nt.appendChild(tb); tf.appendChild(nt);
        panel.appendChild(tf);

        // Note
        var nf = el('div', 'field');
        var nid = 'note-' + r.id;
        var nl = el('label', null, 'My note'); nl.htmlFor = nid;
        var na = el('textarea'); na.id = nid; na.rows = 2; na.maxLength = 1000; na.value = e.note || ''; na.placeholder = 'Like: double the garlic';
        var ns = btn('btn', 'Save note');
        ns.addEventListener('click', function () { act('note', { note: na.value.trim() }, status); });
        nf.appendChild(nl); nf.appendChild(na); var nr = el('div', 'btn-row'); nr.appendChild(ns); nf.appendChild(nr);
        panel.appendChild(nf);

        // Section + remove
        var sf = el('div', 'field');
        var sid2 = 'sec2-' + r.id;
        var sl = el('label', null, 'Section'); sl.htmlFor = sid2;
        var ss = el('select'); ss.id = sid2;
        person.sections.forEach(function (x) { var o = el('option', null, x.title); o.value = x.id; if (x.id === e.section) o.selected = true; ss.appendChild(o); });
        ss.addEventListener('change', function () { act('section', { section: ss.value }, status); });
        sf.appendChild(sl); sf.appendChild(ss); panel.appendChild(sf);

        var rm = btn('linkish', 'Remove from ' + person.name + "'s box");
        rm.addEventListener('click', function () {
          if (rm.getAttribute('data-sure') !== '1') { rm.setAttribute('data-sure', '1'); rm.textContent = 'Tap again to remove. It stays in the whole library.'; return; }
          act('remove', null, status);
        });
        panel.appendChild(rm);
        panel.appendChild(status);
      }
    };
  }

  /* ---------- Recipe view ---------- */
  var wakeLock = null, wantWake = false;
  function setWake(on) {
    wantWake = on;
    var b = $('wake'); if (b) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Screen stays on' : 'Keep screen on'; }
    if (on) navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { if (wakeLock === l) wakeLock = null; });
    }).catch(function () { wantWake = false; var b2 = $('wake'); if (b2) { b2.setAttribute('aria-pressed', 'false'); b2.textContent = 'Keep screen on'; } });
    else if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (wantWake && document.visibilityState === 'visible' && !viewer.hidden) setWake(true);
  });
  function bar(target) {
    var b = el('div', 'vbar');
    var back = btn('vback', '← All recipes');
    back.addEventListener('click', closeFromButton);
    b.appendChild(back);
    target.appendChild(b);
    return { bar: b, back: back };
  }
  function show(which) {
    main.hidden = which !== 'main'; viewer.hidden = which !== 'viewer'; adder.hidden = which !== 'adder';
  }
  function openRecipe(r) {
    current = r;
    viewer.textContent = '';
    var top = bar(viewer);
    if ('wakeLock' in navigator) {
      var w = btn('wake', wantWake ? 'Screen stays on' : 'Keep screen on'); w.id = 'wake';
      w.setAttribute('aria-pressed', String(wantWake));
      w.addEventListener('click', function () { setWake(!wantWake); });
      top.bar.appendChild(w);
      // The lock is released when a recipe closes; if it was on, take it again for this one.
      if (wantWake && !wakeLock) setWake(true);
    }
    var body = el('article', 'vbody');
    var sec = r.section ? sectionById(r.section) : null;
    body.appendChild(el('span', 'eyebrow', r.inBox ? (person.name + "'s box" + (sec ? ' · ' + sec.title : '')) : 'Whole library'));
    renderRecipeBody(r, body, { interactive: true, panel: boxPanel(r) });
    var foot = el('div', 'vfoot'); var back2 = btn(null, '← Back to all recipes');
    back2.addEventListener('click', closeFromButton); foot.appendChild(back2); body.appendChild(foot);
    viewer.appendChild(body);
    show('viewer');
    document.title = r.title + ' · ' + person.title;
    window.scrollTo(0, 0);
    top.back.focus({ preventScroll: true });
  }
  function closeViews() {
    current = null;
    if (main.hidden === false) return;
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    viewer.textContent = '';
    show('main');
    document.title = person.title;
    window.scrollTo({ top: listScroll, behavior: 'auto' });
  }
  function closeFromButton() {
    if (openedFromList) history.back(); else location.hash = 'top';
  }
  function route() {
    var h = location.hash.slice(1);
    if (h.indexOf('r-') === 0 && byId[h.slice(2)]) openRecipe(byId[h.slice(2)]);
    else if (h === 'add') openAdd();
    else { closeViews(); openedFromList = false; }
  }
  window.addEventListener('hashchange', route);

  /* ---------- Add a recipe ---------- */
  var add = { images: [], parsed: null, busy: false };

  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        resolve({ media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as an image.")); };
      img.src = url;
    });
  }

  // Word documents are read in the browser: the text goes into the text box so it can be checked
  // before Claude sees it. The reader (mammoth) is only downloaded the first time someone adds a .docx.
  var MAMMOTH = { src: 'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js', integrity: 'sha384-xqNXvcKbEqifokHcBnB0H32p+OQchhD/T/xJGWCMAW5fC0c0MBf9atO3weoPCT84' };
  var mammothLoad = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (!mammothLoad) mammothLoad = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = MAMMOTH.src; s.integrity = MAMMOTH.integrity; s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(window.mammoth); };
      s.onerror = function () { mammothLoad = null; s.remove(); reject(new Error("Couldn't load the Word reader. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
    return mammothLoad;
  }
  function isDocx(f) { return /\.docx$/i.test(f.name || '') || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  function isOldDoc(f) { return /\.doc$/i.test(f.name || '') || f.type === 'application/msword'; }
  function readDocx(file) {
    return Promise.all([loadMammoth(), file.arrayBuffer()]).then(function (r) {
      var m = r[0], buf = r[1], pics = [];
      var keepPic = m.images.imgElement(function (im) { pics.push(im); return Promise.resolve({ src: '' }); });
      return m.convertToHtml({ arrayBuffer: buf }, { convertImage: keepPic }).then(function (out) {
        return { text: docText(out.value), pics: pics };
      }, function () { throw new Error(file.name + " couldn't be read as a Word document."); });
    });
  }
  // Turns the document into plain lines: one per paragraph, list items keep their numbers or
  // bullets, and each table row stays on one line ("1 cup | oats") so amounts stay with ingredients.
  function docText(html) {
    var body = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body, lines = [];
    var clean = function (s) { return s.replace(/\s+/g, ' ').trim(); };
    function list(n, depth) {
      var i = 0;
      Array.prototype.forEach.call(n.children, function (li) {
        if (li.tagName !== 'LI') return;
        var own = li.cloneNode(true);
        Array.prototype.forEach.call(own.querySelectorAll('ol, ul'), function (x) { x.remove(); });
        var t = clean(own.textContent);
        if (t) lines.push('  '.repeat(depth) + (n.tagName === 'OL' ? ++i + '. ' : '• ') + t);
        Array.prototype.forEach.call(li.children, function (c) { if (c.tagName === 'OL' || c.tagName === 'UL') list(c, depth + 1); });
      });
    }
    Array.prototype.forEach.call(body.children, function (n) {
      if (n.tagName === 'OL' || n.tagName === 'UL') list(n, 0);
      else if (n.tagName === 'TABLE') Array.prototype.forEach.call(n.querySelectorAll('tr'), function (tr) {
        var cells = Array.prototype.map.call(tr.children, function (c) { return clean(c.textContent); }).filter(Boolean);
        if (cells.length) lines.push(cells.join(' | '));
      });
      else {
        var t = clean(n.textContent);
        if (/^H\d$/.test(n.tagName)) lines.push('');
        if (t) lines.push(t);
      }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function picToImage(im) {
    return im.readAsBase64String().then(function (b64) {
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return shrink(new Blob([bytes], { type: im.contentType }));
    }).catch(function () { return null; }); // pictures the browser can't show (old Windows formats) are skipped
  }

  function openAdd() {
    adder.textContent = '';
    add.parsed = null;
    bar(adder);
    adder.appendChild(el('h1', 'vtitle', 'Add a recipe'));
    if (!site.worker) {
      adder.appendChild(el('p', 'status error', "Adding recipes isn't switched on yet. The helper service still needs to be set up (see SETUP.md in the GitHub repo)."));
      show('adder'); window.scrollTo(0, 0); return;
    }
    adder.appendChild(el('p', 'vhint', "Paste a recipe's text, or add a screenshot, photo or Word document. Claude reads it and writes it in the same format as the other recipes. You'll see a preview before anything is saved. New recipes go into the whole library, so everyone can find them."));

    var f1 = el('div', 'field');
    var l1 = el('label', null, 'Recipe text'); l1.htmlFor = 'add-text';
    var ta = el('textarea'); ta.id = 'add-text'; ta.rows = 7; ta.placeholder = 'Paste the recipe here';
    f1.appendChild(l1); f1.appendChild(ta); adder.appendChild(f1);

    var drop = el('div', 'drop');
    var file = el('input'); file.type = 'file'; file.multiple = true; file.id = 'add-file'; file.hidden = true;
    file.accept = 'image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    var pick = btn('btn', 'Add a photo or Word doc');
    pick.addEventListener('click', function () { file.click(); });
    var thumbs = el('div', 'thumbs');
    drop.appendChild(pick); drop.appendChild(file);
    drop.appendChild(el('span', 'hint', "Up to 3 images, for recipes that span a few screenshots. A Word document's text goes into the box above so you can check it. On a computer you can also drag or paste files here."));
    drop.appendChild(thumbs); adder.appendChild(drop);

    function drawThumbs() {
      thumbs.textContent = '';
      add.images.forEach(function (im, i) {
        var t = el('div', 'thumb'); var img = el('img'); img.src = im.preview; img.alt = 'Recipe image ' + (i + 1);
        var x = btn(null, '×'); x.setAttribute('aria-label', 'Remove image ' + (i + 1));
        x.addEventListener('click', function () { add.images.splice(i, 1); drawThumbs(); });
        t.appendChild(img); t.appendChild(x); thumbs.appendChild(t);
      });
    }
    function takeDoc(f) {
      setStatus('Reading ' + f.name + '…');
      return readDocx(f).then(function (d) {
        if (d.text) ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + d.text;
        // A doc that's mostly a pasted-in picture of a recipe: send the pictures. Otherwise the
        // text is the recipe and any photos are just decoration, so leave them out.
        var pics = d.text.length < 80 ? d.pics.slice(0, 3 - add.images.length) : [];
        return Promise.all(pics.map(picToImage)).then(function (ims) {
          ims = ims.filter(Boolean);
          add.images = add.images.concat(ims).slice(0, 3); drawThumbs();
          if (!d.text && !ims.length) { setStatus(f.name + " didn't have any text or pictures that could be read.", true); return; }
          if (ta.value.length > 30000) { setStatus('That document is very long. Trim the text above down to just the recipe, then tap Read recipe.', true); return; }
          var got = d.text && ims.length ? 'the text and pictures' : d.text ? 'the text' : 'the pictures';
          setStatus('Got ' + got + ' from ' + f.name + '. Check ' + (d.text ? 'the text above' : 'them') + ', then tap Read recipe.');
        });
      }).catch(function (e) { setStatus(e.message, true); });
    }
    function takeFiles(list) {
      var all = Array.prototype.slice.call(list);
      if (all.some(isOldDoc)) setStatus("That's an older Word file (.doc). Open it in Word, use Save As → Word Document (.docx), and add that instead. Or copy the text and paste it above.", true);
      all.filter(isDocx).reduce(function (p, f) { return p.then(function () { return takeDoc(f); }); }, Promise.resolve());
      var files = all.filter(function (f) { return /^image\//.test(f.type); }).slice(0, 3 - add.images.length);
      if (!files.length) return;
      setStatus('Preparing images…');
      Promise.all(files.map(shrink)).then(function (ims) { add.images = add.images.concat(ims).slice(0, 3); drawThumbs(); setStatus(''); })
        .catch(function (e) { setStatus(e.message, true); });
    }
    file.addEventListener('change', function () { takeFiles(file.files); file.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); takeFiles(e.dataTransfer.files); });
    adder.onpaste = function (e) {
      var files = Array.prototype.map.call(e.clipboardData.items || [], function (it) { return it.kind === 'file' ? it.getAsFile() : null; }).filter(Boolean);
      if (files.length) { e.preventDefault(); takeFiles(files); }
    };
    drawThumbs();

    var pass = passRow(adder);
    var go = btn('btn primary', 'Read recipe');
    var row = el('div', 'btn-row'); row.appendChild(go); adder.appendChild(row);
    var status = el('p', 'status'); status.setAttribute('aria-live', 'polite'); adder.appendChild(status);
    var previewWrap = el('div'); adder.appendChild(previewWrap);

    function setStatus(msg, isErr) { status.textContent = msg; status.className = 'status' + (isErr ? ' error' : ''); }

    function runParse(extra) {
      if (add.busy) return;
      var text = ta.value.trim();
      if (!text && !add.images.length) { setStatus('Paste some text or add an image first.', true); return; }
      if (pass.need()) { setStatus('Enter the passcode.', true); return; }
      add.busy = true; go.disabled = true;
      var t0 = Date.now();
      setStatus('Reading the recipe… this usually takes 20–60 seconds.');
      var tick = setInterval(function () { setStatus('Reading the recipe… ' + Math.round((Date.now() - t0) / 1000) + ' sec'); }, 1000);
      var payload = {
        passcode: pass.get(), person: PERSON, text: text,
        images: add.images.map(function (im) { return { media_type: im.media_type, data: im.data }; }),
        sections: person.sections.map(function (s) { return { id: s.id, title: s.title }; })
      };
      if (extra) { payload.previous = extra.previous; payload.fix = extra.fix; }
      helper('/parse', payload).then(function (j) {
        pass.ok();
        add.parsed = j;
        setStatus('');
        renderPreview();
      }).catch(function (e) {
        if (e.status === 401) pass.bad();
        setStatus(errText(e), true);
      }).then(function () { clearInterval(tick); add.busy = false; go.disabled = false; });
    }
    go.addEventListener('click', function () { runParse(); });

    function renderPreview() {
      previewWrap.textContent = '';
      var p = add.parsed;
      var r = Object.assign({ myTags: [], made: 0, inBox: false, confidence: 'clear', blurb: p.note || '' }, p.recipe);
      var pv = el('div', 'preview');
      pv.appendChild(el('span', 'eyebrow', 'Preview, not saved yet'));
      renderRecipeBody(r, pv, { interactive: false, headingTag: 'h2' });
      if (p.assumptions && p.assumptions.length) {
        var ab = el('div', 'vbox warn'); ab.appendChild(el('h3', null, 'What Claude filled in or changed'));
        var ul = el('ul'); p.assumptions.forEach(function (a) { ul.appendChild(el('li', null, a)); }); ab.appendChild(ul);
        pv.appendChild(ab);
      }

      var ff = el('div', 'field');
      var fl = el('label', null, 'Something off?'); fl.htmlFor = 'add-fix';
      var fix = el('textarea'); fix.id = 'add-fix'; fix.rows = 2; fix.placeholder = "Like: it's 2 cups of rice, not 1";
      var fixBtn = btn('btn', 'Fix it');
      fixBtn.addEventListener('click', function () {
        if (!fix.value.trim()) { fix.focus(); return; }
        runParse({ previous: p.recipe, fix: fix.value.trim() });
      });
      ff.appendChild(fl); ff.appendChild(fix); var fr = el('div', 'btn-row'); fr.appendChild(fixBtn); ff.appendChild(fr);
      pv.appendChild(ff);

      var fs = el('fieldset', 'field choices');
      fs.appendChild(el('legend', null, 'Where should it go?'));
      var opts = [['new', 'Library and ' + person.name + "'s box"], ['made', 'Library and ' + person.name + "'s box, marked as made today"], ['library', 'Library only']];
      opts.forEach(function (o, i) {
        var lab = el('label', 'choice'); var rb = el('input'); rb.type = 'radio'; rb.name = 'add-where'; rb.value = o[0]; rb.checked = i === 0;
        lab.appendChild(rb); lab.appendChild(el('span', null, o[1])); fs.appendChild(lab);
      });
      pv.appendChild(fs);

      var fsec = el('div', 'field');
      var sl = el('label', null, 'Section'); sl.htmlFor = 'add-section';
      var ss = el('select'); ss.id = 'add-section';
      person.sections.forEach(function (s) {
        var o = el('option', null, s.title); o.value = s.id; if (s.id === p.suggestedSection) o.selected = true; ss.appendChild(o);
      });
      fsec.appendChild(sl); fsec.appendChild(ss); pv.appendChild(fsec);

      var fn = el('div', 'field');
      var nl = el('label', null, 'Short description for the card'); nl.htmlFor = 'add-note';
      var nt = el('textarea'); nt.id = 'add-note'; nt.rows = 2; nt.value = p.note || '';
      fn.appendChild(nl); fn.appendChild(nt); pv.appendChild(fn);

      fs.addEventListener('change', function () { fsec.hidden = fs.querySelector('input:checked').value === 'library'; });

      var saveBtn = btn('btn primary', 'Save recipe');
      var again = btn('btn', 'Start over');
      again.addEventListener('click', function () { add.images = []; openAdd(); window.scrollTo(0, 0); });
      var sr = el('div', 'btn-row'); sr.appendChild(saveBtn); sr.appendChild(again); pv.appendChild(sr);
      var sstatus = el('p', 'status'); sstatus.setAttribute('aria-live', 'polite'); pv.appendChild(sstatus);

      saveBtn.addEventListener('click', function () {
        if (add.busy) return;
        var where = fs.querySelector('input:checked').value;
        add.busy = true; saveBtn.disabled = true;
        sstatus.className = 'status'; sstatus.textContent = 'Saving…';
        helper('/save', {
          passcode: pass.get(), person: PERSON, recipe: p.recipe,
          box: { mode: where, section: ss.value, blurb: nt.value.trim(), date: fmtDate(new Date()) }
        }).then(function (j) {
          library.push(j.recipe);
          if (j.entry) person.box.push(j.entry);
          refresh();
          renderDone(j.recipe, !!j.entry);
        }).catch(function (e) {
          if (e.status === 401) pass.bad();
          sstatus.className = 'status error'; sstatus.textContent = errText(e);
        }).then(function () { add.busy = false; saveBtn.disabled = false; });
      });

      previewWrap.appendChild(pv);
      pv.scrollIntoView({ block: 'start' });
    }

    function renderDone(r, inBox) {
      adder.textContent = '';
      bar(adder);
      adder.appendChild(el('h1', 'vtitle', 'Saved'));
      adder.appendChild(el('p', null, '"' + r.title + '" is in the whole library' + (inBox ? ' and in ' + person.name + "'s box" : '') + '. It shows here now. Everyone else will see it in about 2 minutes, once the site rebuilds.'));
      var row2 = el('div', 'btn-row');
      var view = el('a', 'btn primary', 'View recipe'); view.href = '#r-' + r.id;
      var another = btn('btn', 'Add another');
      another.addEventListener('click', function () { add.images = []; openAdd(); window.scrollTo(0, 0); });
      row2.appendChild(view); row2.appendChild(another); adder.appendChild(row2);
      window.scrollTo(0, 0);
    }

    show('adder');
    document.title = 'Add a recipe · ' + person.title;
    window.scrollTo(0, 0);
  }

  /* ---------- Start ---------- */
  Promise.all([getJSON('library/recipes.json'), getJSON('people/' + PERSON + '.json'), getJSON('site.json').catch(function () { return {}; })])
    .then(function (res) {
      library = res[0].recipes; person = res[1]; site = res[2] || {};
      pron = PRON[person.pronoun] || PRON.they;
      merge();
      var savedSel = load('ek-filters-' + PERSON);
      if (savedSel) GROUPS.forEach(function (g) { if (Array.isArray(savedSel[g])) sel[g] = savedSel[g].slice(); });
      mode = load('ek-mode-' + PERSON) === 'library' ? 'library' : 'box';
      renderHeader();
      chips().forEach(function (b) {
        var g = b.getAttribute('data-group');
        sel[g] = sel[g].filter(function (v) { return chips().some(function (c) { return c.getAttribute('data-group') === g && c.getAttribute('data-value') === v; }); });
      });
      renderList(); apply(); route();
    }).catch(function () {
      results.textContent = '';
      results.appendChild(el('p', 'loading', "The recipes didn't load. Check your connection and refresh the page."));
    });
})();
