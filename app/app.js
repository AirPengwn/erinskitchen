/* Kitchen site app. Shared by every person's page.
   Each page sets window.KITCHEN = { person: "erin", root: "./" } before loading this file.
   Data: library/recipes.json (shared recipes), people/<person>.json (their box), site.json (helper URL). */
(function () {
  var CFG = window.KITCHEN || {};
  var ROOT = CFG.root || './';
  var PERSON = CFG.person;
  var LABEL = { chicken: 'Chicken', beef: 'Beef', pork: 'Pork', seafood: 'Seafood', eggs: 'Eggs', meatless: 'Meatless' };
  var CONF = { likely: 'Likely', guess: 'Best guess' };
  var CONF_NOTE = { likely: "Likely: I'm fairly sure this is the dish, but not certain.", guess: "Best guess: the photo doesn't show enough to be sure." };
  var PRON = {
    she: { poss: 'Her', made: "She's made it", made2: "something she's made" },
    he: { poss: 'His', made: "He's made it", made2: "something he's made" },
    they: { poss: 'Their', made: "They've made it", made2: "something they've made" }
  };
  var GROUPS = ['source', 'protein', 'slow', 'cozy'];
  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), viewer = $('viewer'), adder = $('adder'), results = $('results'), qEl = $('q');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.fchip'));
  var person = null, site = {}, library = [], recipes = [], sections = [], byId = {}, pron = PRON.they;
  var sel = { source: [], protein: [], slow: [], cozy: [] };
  var query = '';
  var listScroll = 0, openedFromList = false;

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function forget(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fmtDate(iso) { var d = new Date(iso + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function getJSON(path) {
    return fetch(ROOT + path, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
  }

  /* ---------- Data ---------- */
  function merge() {
    var box = {};
    person.box.forEach(function (b, i) { box[b.id] = Object.assign({ order: i }, b); });
    sections = person.sections.slice();
    var extras = library.filter(function (r) { return !box[r.id]; });
    if (extras.length) {
      sections.push({ id: 'shared-library', kind: 'library', title: 'From the shared library',
        intro: "Recipes in the shared library that aren't in " + person.name + "'s box yet." });
    }
    recipes = library.map(function (lr) {
      var b = box[lr.id];
      var r = Object.assign({}, lr);
      if (b) {
        r.section = b.section; r.source = b.source; r.note = b.note || ''; r.madeTimes = b.madeTimes;
        r.madeDates = b.madeDates; r.confidence = b.confidence || 'clear'; r._order = b.order;
      } else {
        r.section = 'shared-library'; r.source = 'library'; r.confidence = 'clear'; r._order = 100000;
        r.note = r.credit ? 'From ' + r.credit + '.' : 'Added ' + (fmtDate(r.addedAt) || 'recently') + '.';
      }
      return r;
    });
    recipes.sort(function (a, b) { return a._order - b._order || (b.addedAt || '').localeCompare(a.addedAt || ''); });
    byId = {};
    recipes.forEach(function (r) {
      byId[r.id] = r;
      var sec = sectionOf(r);
      r._hay = norm([r.title, r.note, sec ? sec.title : '', r.madeDates || '', r.credit || '',
        r.proteins.map(function (p) { return LABEL[p]; }).join(' '),
        r.slowCooker ? 'slow cooker crockpot' : '', r.cozy ? 'warm cozy fall' : '',
        r.source === 'made' ? "made it" : r.source === 'new' ? 'new idea' : 'library',
        r.ingredients.map(function (g) { return (g.group || '') + ' ' + g.items.join(' '); }).join(' '),
        (r.equipment || []).join(' ')].join(' '));
    });
  }
  function sectionOf(r) { return sections.filter(function (s) { return s.id === r.section; })[0]; }

  /* ---------- Filters ---------- */
  function values(r, g) {
    if (g === 'source') return [r.source];
    if (g === 'protein') return r.proteins;
    if (g === 'slow') return r.slowCooker ? ['on'] : [];
    return r.cozy ? ['on'] : [];
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
    return matchesQuery(r) && GROUPS.every(function (g) { return g === skip || inGroup(r, g); });
  }

  /* ---------- Rendering ---------- */
  function tagsFor(r) {
    var t = el('div', 'tags');
    if (r.source === 'made') t.appendChild(el('span', 'tag made', pron.made));
    if (r.source === 'library') t.appendChild(el('span', 'tag', 'Shared library'));
    r.proteins.forEach(function (p) { t.appendChild(el('span', 'tag', LABEL[p])); });
    if (r.slowCooker) t.appendChild(el('span', 'tag warm', 'Slow cooker'));
    if (r.cozy) t.appendChild(el('span', 'tag warm', 'Warm & cozy'));
    if (CONF[r.confidence]) t.appendChild(el('span', 'tag conf', CONF[r.confidence]));
    return t;
  }
  function madeLabel(r) { return r.madeTimes === 1 ? 'Made once' : r.madeTimes ? 'Made ' + r.madeTimes + '×' : ''; }
  function metaFor(r) {
    var parts = [];
    if (r.source === 'made' && madeLabel(r)) parts.push(madeLabel(r));
    if (r.total) parts.push(r.total);
    if (r.servings) parts.push(r.servings);
    return parts.join(' · ');
  }

  function renderHeader() {
    document.title = person.title;
    $('title').textContent = person.title;
    $('handle').textContent = person.handle ? 'From ' + person.handle : '';
    var av = $('avatar');
    if (person.avatar) { av.src = ROOT + person.avatar; av.alt = person.avatarAlt || ''; av.hidden = false; }
    var made = recipes.filter(function (r) { return r.source === 'made'; });
    var times = made.reduce(function (n, r) { return n + (r.madeTimes || 0); }, 0);
    var stats = [
      [made.length, 'dishes in ' + pron.poss.toLowerCase() + ' recipe box'],
      [times, 'times ' + (person.pronoun === 'they' ? "they've" : (person.pronoun || 'they') + "'s") + ' cooked them'],
      [recipes.filter(function (r) { return r.source === 'new'; }).length, 'new recipe ideas'],
      [library.length, 'recipes in the shared library']
    ];
    var s = $('stats'); s.textContent = '';
    stats.forEach(function (x) { var d = el('div'); d.appendChild(el('b', null, String(x[0]))); d.appendChild(el('span', null, x[1])); s.appendChild(d); });
    $('updated').textContent = person.updated ? 'Updated ' + fmtDate(person.updated) : '';
    var madeChip = document.querySelector('.fchip[data-value="made"]');
    if (madeChip) madeChip.firstChild.textContent = pron.made + ' ';
    var libChip = document.querySelector('.fchip[data-value="library"]');
    if (libChip) libChip.hidden = !recipes.some(function (r) { return r.source === 'library'; });
  }

  function renderList() {
    results.textContent = '';
    var kinds = { made: pron.poss + ' recipe box', new: 'New ideas', library: 'Shared library' };
    var counts = {}, totals = {};
    sections.forEach(function (s) { totals[s.kind] = (totals[s.kind] || 0) + 1; });
    ['made', 'new', 'library'].forEach(function (kind) {
      sections.filter(function (s) { return s.kind === kind; }).forEach(function (s) {
        counts[kind] = (counts[kind] || 0) + 1;
        var sec = el('section', 'rsection'); sec.id = 's-' + s.id;
        var head = el('div', 'section-head');
        head.appendChild(el('span', 'eyebrow', kinds[kind] + (totals[kind] > 1 ? ' · ' + counts[kind] + ' of ' + totals[kind] : '')));
        head.appendChild(el('h2', null, s.title));
        if (s.intro) head.appendChild(el('p', null, s.intro));
        sec.appendChild(head);
        var grid = el('div', 'cards');
        recipes.filter(function (r) { return r.section === s.id; }).forEach(function (r) {
          var a = el('a', 'card'); a.href = '#r-' + r.id; r._card = a;
          var top = el('div', 'card-top'); top.appendChild(el('h3', null, r.title)); top.appendChild(el('span', 'meta', metaFor(r)));
          a.appendChild(top); a.appendChild(tagsFor(r)); if (r.note) a.appendChild(el('p', 'cnote', r.note));
          a.appendChild(el('span', 'open', 'Open recipe →'));
          grid.appendChild(a);
        });
        sec.appendChild(grid); results.appendChild(sec);
      });
    });
  }

  function apply() {
    var shown = 0;
    recipes.forEach(function (r) { var ok = matches(r); if (r._card) r._card.hidden = !ok; if (ok) shown++; });
    results.querySelectorAll('.rsection').forEach(function (s) { s.hidden = !s.querySelector('.card:not([hidden])'); });
    var filtered = !!query || GROUPS.some(function (g) { return sel[g].length; });
    var about = $('about'); if (about) about.hidden = filtered;
    chips.forEach(function (b) {
      var g = b.getAttribute('data-group'), v = b.getAttribute('data-value');
      var on = sel[g].indexOf(v) !== -1;
      b.setAttribute('aria-pressed', String(on));
      var n = recipes.filter(function (r) { return matches(r, g) && values(r, g).indexOf(v) !== -1; }).length;
      b.querySelector('.n').textContent = n;
      b.disabled = !on && n === 0;
    });
    $('count').textContent = filtered ? shown + ' of ' + recipes.length + ' recipes' : recipes.length + ' recipes';
    $('clear').hidden = !filtered;
    $('empty').hidden = shown > 0;
    store('ek-filters', sel);
  }

  chips.forEach(function (b) {
    b.addEventListener('click', function () {
      var g = b.getAttribute('data-group'), v = b.getAttribute('data-value');
      var i = sel[g].indexOf(v);
      if (i === -1) sel[g].push(v); else sel[g].splice(i, 1);
      apply();
    });
  });
  qEl.addEventListener('input', function () { query = norm(qEl.value.trim()); apply(); });
  function clearAll() { GROUPS.forEach(function (g) { sel[g] = []; }); qEl.value = ''; query = ''; apply(); }
  $('clear').addEventListener('click', clearAll);
  $('reset').addEventListener('click', clearAll);
  results.addEventListener('click', function (e) { if (e.target.closest('.card')) { listScroll = window.scrollY; openedFromList = true; } });
  $('add-open').addEventListener('click', function () { listScroll = window.scrollY; openedFromList = true; });

  /* ---------- Recipe body (used by the recipe view and the add preview) ---------- */
  function renderRecipeBody(r, body, opts) {
    var interactive = opts.interactive;
    var saved = interactive ? (load('ek-check-' + r.id) || { i: [], s: [] }) : { i: [], s: [] };
    function save() { if (interactive) store('ek-check-' + r.id, saved); }
    var sec = sectionOf(r);
    if (opts.eyebrow !== false) {
      var kind = r.source === 'made' ? pron.poss + ' recipe box' : r.source === 'new' ? 'New idea' : 'Shared library';
      body.appendChild(el('span', 'eyebrow', kind + (sec ? ' · ' + sec.title : '')));
    }
    body.appendChild(el(opts.headingTag || 'h1', 'vtitle', r.title));
    body.appendChild(tagsFor(r));
    if (r.source === 'made' && r.madeDates) body.appendChild(el('p', 'vmeta', [madeLabel(r), r.madeDates].filter(Boolean).join(' · ')));
    var facts = [['Serves', r.servings], ['Prep', r.prep], ['Cook', r.cook], ['Total', r.total]].filter(function (f) { return f[1]; });
    if (facts.length) {
      var fg = el('dl', 'vfacts');
      facts.forEach(function (f) { var d = el('div'); d.appendChild(el('dt', null, f[0])); d.appendChild(el('dd', null, f[1])); fg.appendChild(d); });
      body.appendChild(fg);
    }
    if (r.note) {
      var note = el('p', 'vnote');
      note.appendChild(el('b', null, r.source === 'made' ? 'In ' + pron.poss.toLowerCase() + ' photos' : r.source === 'new' ? "Why " + (person.pronoun || 'they') + "'d like it" : 'About this recipe'));
      note.appendChild(document.createTextNode(r.note));
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
    if (interactive) { resetBtn = el('button', null, 'Uncheck all'); resetBtn.type = 'button'; ih.appendChild(resetBtn); }
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
      var li = el('li'), b = el('button', 'step'); b.type = 'button';
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

  /* ---------- Recipe view ---------- */
  var wakeLock = null, wantWake = false;
  function setWake(on) {
    wantWake = on;
    var b = $('wake'); if (b) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Screen stays on' : 'Keep screen on'; }
    if (on) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { wantWake = false; var b2 = $('wake'); if (b2) { b2.setAttribute('aria-pressed', 'false'); b2.textContent = 'Keep screen on'; } });
    else if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (wantWake && document.visibilityState === 'visible' && !viewer.hidden) setWake(true);
  });
  function bar(target) {
    var b = el('div', 'vbar');
    var back = el('button', 'vback', '← All recipes'); back.type = 'button';
    back.addEventListener('click', closeFromButton);
    b.appendChild(back);
    target.appendChild(b);
    return { bar: b, back: back };
  }
  function show(which) {
    main.hidden = which !== 'main'; viewer.hidden = which !== 'viewer'; adder.hidden = which !== 'adder';
  }
  function openRecipe(r) {
    viewer.textContent = '';
    var top = bar(viewer);
    if ('wakeLock' in navigator) {
      var w = el('button', 'wake', wantWake ? 'Screen stays on' : 'Keep screen on'); w.type = 'button'; w.id = 'wake';
      w.setAttribute('aria-pressed', String(wantWake));
      w.addEventListener('click', function () { setWake(!wantWake); });
      top.bar.appendChild(w);
    }
    var body = el('article', 'vbody');
    renderRecipeBody(r, body, { interactive: true });
    var foot = el('div', 'vfoot'); var back2 = el('button', null, '← Back to all recipes'); back2.type = 'button';
    back2.addEventListener('click', closeFromButton); foot.appendChild(back2); body.appendChild(foot);
    viewer.appendChild(body);
    show('viewer');
    document.title = r.title + ' · ' + person.title;
    window.scrollTo(0, 0);
    top.back.focus({ preventScroll: true });
  }
  function closeViews() {
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
  var PASS_KEY = 'ek-pass';

  function helper(path, body) {
    return fetch(site.worker.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || ('The helper answered ' + res.status + '.')); e.status = res.status; throw e; }
        return j;
      });
    });
  }

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

  function openAdd() {
    adder.textContent = '';
    add.parsed = null;
    bar(adder);
    adder.appendChild(el('h1', 'vtitle', 'Add a recipe'));
    if (!site.worker) {
      adder.appendChild(el('p', 'status error', "Adding recipes isn't switched on yet. The helper service still needs to be set up (see SETUP.md in the GitHub repo)."));
      show('adder'); window.scrollTo(0, 0); return;
    }
    adder.appendChild(el('p', 'vhint', "Paste a recipe's text, add a screenshot or photo, or both. Claude reads it and writes it in the same format as the other recipes. You'll see a preview before anything is saved."));

    var f1 = el('div', 'field');
    var l1 = el('label', null, 'Recipe text'); l1.htmlFor = 'add-text';
    var ta = el('textarea'); ta.id = 'add-text'; ta.rows = 7; ta.placeholder = 'Paste the recipe here';
    f1.appendChild(l1); f1.appendChild(ta); adder.appendChild(f1);

    var drop = el('div', 'drop');
    var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.id = 'add-file'; file.hidden = true;
    var pick = el('button', 'btn', 'Add a screenshot or photo'); pick.type = 'button';
    pick.addEventListener('click', function () { file.click(); });
    var thumbs = el('div', 'thumbs');
    drop.appendChild(pick); drop.appendChild(file);
    drop.appendChild(el('span', 'hint', 'Up to 3 images, for recipes that span a few screenshots. On a computer you can also drag or paste them here.'));
    drop.appendChild(thumbs); adder.appendChild(drop);

    function drawThumbs() {
      thumbs.textContent = '';
      add.images.forEach(function (im, i) {
        var t = el('div', 'thumb'); var img = el('img'); img.src = im.preview; img.alt = 'Recipe image ' + (i + 1);
        var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove image ' + (i + 1));
        x.addEventListener('click', function () { add.images.splice(i, 1); drawThumbs(); });
        t.appendChild(img); t.appendChild(x); thumbs.appendChild(t);
      });
    }
    function takeFiles(list) {
      var files = Array.prototype.filter.call(list, function (f) { return /^image\//.test(f.type); }).slice(0, 3 - add.images.length);
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

    var savedPass = load(PASS_KEY);
    var f2 = el('div', 'field');
    var l2 = el('label', null, 'Passcode'); l2.htmlFor = 'add-pass';
    var pass = el('input'); pass.type = 'password'; pass.id = 'add-pass'; pass.autocomplete = 'current-password';
    var passHint = el('span', 'hint', 'Remembered on this device after the first time.');
    f2.appendChild(l2); f2.appendChild(pass); f2.appendChild(passHint);
    var swap = el('button', 'linkish', 'Use a different passcode'); swap.type = 'button';
    swap.addEventListener('click', function () { forget(PASS_KEY); f2.hidden = false; swap.hidden = true; pass.focus(); });
    f2.hidden = !!savedPass; swap.hidden = !savedPass;
    adder.appendChild(f2); adder.appendChild(swap);

    var go = el('button', 'btn primary', 'Read recipe'); go.type = 'button';
    var row = el('div', 'btn-row'); row.appendChild(go); adder.appendChild(row);
    var status = el('p', 'status'); status.setAttribute('aria-live', 'polite'); adder.appendChild(status);
    var previewWrap = el('div'); adder.appendChild(previewWrap);

    function setStatus(msg, isErr) { status.textContent = msg; status.className = 'status' + (isErr ? ' error' : ''); }
    function passcode() { return load(PASS_KEY) || pass.value.trim(); }

    function runParse(extra) {
      if (add.busy) return;
      var text = ta.value.trim();
      if (!text && !add.images.length) { setStatus('Paste some text or add an image first.', true); return; }
      if (!passcode()) { setStatus('Enter the passcode.', true); f2.hidden = false; pass.focus(); return; }
      add.busy = true; go.disabled = true;
      var t0 = Date.now();
      setStatus('Reading the recipe… this usually takes 20–60 seconds.');
      var tick = setInterval(function () { setStatus('Reading the recipe… ' + Math.round((Date.now() - t0) / 1000) + ' sec'); }, 1000);
      var payload = {
        passcode: passcode(), person: PERSON, text: text,
        images: add.images.map(function (im) { return { media_type: im.media_type, data: im.data }; }),
        sections: person.sections.map(function (s) { return { id: s.id, title: s.title }; })
      };
      if (extra) { payload.previous = extra.previous; payload.fix = extra.fix; }
      helper('/parse', payload).then(function (j) {
        if (!load(PASS_KEY)) store(PASS_KEY, pass.value.trim());
        f2.hidden = true; swap.hidden = false;
        add.parsed = j;
        setStatus('');
        renderPreview();
      }).catch(function (e) {
        if (e.status === 401) { forget(PASS_KEY); f2.hidden = false; swap.hidden = true; pass.value = ''; }
        setStatus(e.message || "Something went wrong. Check your connection and try again.", true);
      }).then(function () { clearInterval(tick); add.busy = false; go.disabled = false; });
    }
    go.addEventListener('click', function () { runParse(); });

    function renderPreview() {
      previewWrap.textContent = '';
      var p = add.parsed, r = Object.assign({ source: 'library', confidence: 'clear', note: '' }, p.recipe);
      var pv = el('div', 'preview');
      pv.appendChild(el('span', 'eyebrow', 'Preview, not saved yet'));
      renderRecipeBody(r, pv, { interactive: false, eyebrow: false, headingTag: 'h2' });
      if (p.assumptions && p.assumptions.length) {
        var ab = el('div', 'vbox warn'); ab.appendChild(el('h3', null, 'What Claude filled in or changed'));
        var ul = el('ul'); p.assumptions.forEach(function (a) { ul.appendChild(el('li', null, a)); }); ab.appendChild(ul);
        pv.appendChild(ab);
      }

      var ff = el('div', 'field');
      var fl = el('label', null, 'Something off?'); fl.htmlFor = 'add-fix';
      var fix = el('textarea'); fix.id = 'add-fix'; fix.rows = 2; fix.placeholder = "Like: it's 2 cups of rice, not 1";
      var fixBtn = el('button', 'btn', 'Fix it'); fixBtn.type = 'button';
      fixBtn.addEventListener('click', function () {
        if (!fix.value.trim()) { fix.focus(); return; }
        runParse({ previous: p.recipe, fix: fix.value.trim() });
      });
      ff.appendChild(fl); ff.appendChild(fix); var fr = el('div', 'btn-row'); fr.appendChild(fixBtn); ff.appendChild(fr);
      pv.appendChild(ff);

      var fs = el('fieldset', 'field choices');
      fs.appendChild(el('legend', null, 'Where should it go?'));
      var opts = [['new', 'In ' + person.name + "'s box as a new idea"], ['made', 'In ' + person.name + "'s box as " + pron.made2], ['library', 'Shared library only']];
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
      var nl = el('label', null, 'Note on the card'); nl.htmlFor = 'add-note';
      var nt = el('textarea'); nt.id = 'add-note'; nt.rows = 2; nt.value = p.note || '';
      fn.appendChild(nl); fn.appendChild(nt); pv.appendChild(fn);

      fs.addEventListener('change', function () {
        var mode = fs.querySelector('input:checked').value;
        fsec.hidden = mode === 'library';
      });

      var saveBtn = el('button', 'btn primary', 'Save recipe'); saveBtn.type = 'button';
      var again = el('button', 'btn', 'Start over'); again.type = 'button';
      again.addEventListener('click', function () { add.images = []; openAdd(); window.scrollTo(0, 0); });
      var sr = el('div', 'btn-row'); sr.appendChild(saveBtn); sr.appendChild(again); pv.appendChild(sr);
      var sstatus = el('p', 'status'); sstatus.setAttribute('aria-live', 'polite'); pv.appendChild(sstatus);

      saveBtn.addEventListener('click', function () {
        if (add.busy) return;
        var mode = fs.querySelector('input:checked').value;
        add.busy = true; saveBtn.disabled = true;
        sstatus.className = 'status'; sstatus.textContent = 'Saving…';
        helper('/save', {
          passcode: passcode(), person: PERSON, recipe: p.recipe,
          box: { mode: mode, section: ss.value, note: nt.value.trim() }
        }).then(function (j) {
          var saved = Object.assign({}, p.recipe, j.recipe || {}, { id: j.id });
          library.push(saved);
          if (mode !== 'library' && j.boxEntry) person.box.push(j.boxEntry);
          merge(); renderHeader(); renderList(); apply();
          renderDone(saved);
        }).catch(function (e) {
          if (e.status === 401) forget(PASS_KEY);
          sstatus.className = 'status error'; sstatus.textContent = e.message || "It didn't save. Try again.";
        }).then(function () { add.busy = false; saveBtn.disabled = false; });
      });

      previewWrap.appendChild(pv);
      pv.scrollIntoView({ block: 'start' });
    }

    function renderDone(r) {
      adder.textContent = '';
      bar(adder);
      adder.appendChild(el('h1', 'vtitle', 'Saved'));
      adder.appendChild(el('p', null, '"' + r.title + '" is in the shared library' + (byId[r.id] && byId[r.id].source !== 'library' ? ' and in ' + person.name + "'s box" : '') + '. It shows here now. Everyone else will see it in about 2 minutes, once the site rebuilds.'));
      var row2 = el('div', 'btn-row');
      var view = el('a', 'btn primary', 'View recipe'); view.href = '#r-' + r.id;
      var another = el('button', 'btn', 'Add another'); another.type = 'button';
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
      var savedSel = load('ek-filters');
      if (savedSel) GROUPS.forEach(function (g) {
        if (Array.isArray(savedSel[g])) sel[g] = savedSel[g].filter(function (v) {
          return chips.some(function (b) { return b.getAttribute('data-group') === g && b.getAttribute('data-value') === v; });
        });
      });
      renderHeader(); renderList(); apply(); route();
    }).catch(function () {
      results.textContent = '';
      results.appendChild(el('p', 'loading', "The recipes didn't load. Check your connection and refresh the page."));
    });
})();
