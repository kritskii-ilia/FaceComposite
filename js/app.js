/*
 * app.js — оркестратор: состояние карточки, цикл перерисовки, обработчики.
 * Состояние сознательно простое и сериализуемое целиком в JSON — это и есть
 * формат проекта (.fcase.json) и запись в localStorage.
 */
(function (FC) {
  'use strict';

  let state = null;

  function newCaseState() {
    return {
      id: 'case-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      title: 'Новая карточка',
      operator: '',
      subjectType: 'suspect',
      createdAt: new Date().toISOString(),
      description: '',
      profile: FC.traits.defaultProfile(),
      versions: [],
    };
  }

  function render() {
    const svg = FC.render.buildSVG(state.profile);
    document.getElementById('portrait').innerHTML = svg;
  }

  function syncMeta() {
    document.getElementById('case-title').value = state.title;
    document.getElementById('case-operator').value = state.operator;
    document.getElementById('case-subject').value = state.subjectType;
    document.getElementById('description').value = state.description;
    FC.ui.sync(state.profile);
    FC.ui.renderVersions(state.versions, restoreVersion);
  }

  /* ---------- обработчики признаков ---------- */
  const handlers = {
    onTrait: (key, value) => { state.profile.values[key] = value; render(); pushHistory(); },
    onParam: (key, value) => { state.profile.params[key] = value; render(); pushHistory(); },
    onMark: (mark, on) => {
      const arr = state.profile.marks;
      const i = arr.indexOf(mark);
      if (on && i === -1) arr.push(mark);
      if (!on && i !== -1) arr.splice(i, 1);
      render(); pushHistory();
    },
  };

  /* ---------- история правок (отмена/повтор) ---------- */
  let undoStack = [];
  let redoStack = [];

  function snap() { return JSON.stringify(state.profile); }
  function historyInit() { undoStack = [snap()]; redoStack = []; updateUndoUI(); }

  // Снимок с дебаунсом: серия тиков ползунка схлопывается в одно состояние.
  function pushHistory() {
    clearTimeout(pushHistory._t);
    pushHistory._t = setTimeout(() => {
      const s = snap();
      if (undoStack[undoStack.length - 1] !== s) {
        undoStack.push(s);
        if (undoStack.length > 60) undoStack.shift();
        redoStack = [];
        updateUndoUI();
      }
    }, 320);
  }
  function applySnapshot(s) {
    state.profile = JSON.parse(s);
    FC.ui.sync(state.profile);
    render();
    updateUndoUI();
  }
  function undo() {
    clearTimeout(pushHistory._t);
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    applySnapshot(undoStack[undoStack.length - 1]);
  }
  function redo() {
    if (!redoStack.length) return;
    const s = redoStack.pop();
    undoStack.push(s);
    applySnapshot(s);
  }
  function updateUndoUI() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.classList.toggle('disabled', undoStack.length < 2);
    if (r) r.classList.toggle('disabled', redoStack.length === 0);
  }

  // Готовые описания для быстрой демонстрации на выставке.
  const PRESETS = [
    { label: 'Мужчина с бородой', text: 'Мужчина лет сорока, овальное лицо, тёмные короткие волосы, густые брови, прямой нос, карие глаза, короткая борода, шрам на щеке, очки' },
    { label: 'Молодая женщина', text: 'Молодая женщина, овальное лицо, длинные тёмные волосы, миндалевидные карие глаза, тонкий нос, полные губы, родинка у губы' },
    { label: 'Пожилой мужчина', text: 'Пожилой мужчина, узкое лицо, лысина с залысинами, седые усы, нос с горбинкой, нависшие веки, морщины' },
    { label: 'Девушка', text: 'Девушка, круглое лицо, длинные рыжие волосы, большие голубые глаза, курносый нос, веснушки' },
    { label: 'Ребёнок', text: 'Ребёнок, круглое лицо, светлые короткие волосы, большие зелёные глаза, маленький курносый нос' },
    { label: 'Подозреваемый', text: 'Мужчина, квадратное лицо, массивный подбородок, тёмные очки, бритая голова, густая борода, широкий нос, прямые брови' },
  ];
  function buildPresets() {
    const host = document.getElementById('presets');
    host.innerHTML = '';
    PRESETS.forEach((pr) => {
      const b = document.createElement('button');
      b.className = 'preset'; b.textContent = pr.label;
      b.addEventListener('click', () => {
        document.getElementById('description').value = pr.text;
        buildFromDescription();
      });
      host.appendChild(b);
    });
  }

  /* ---------- офлайн голосовой ввод (только в нативном приложении) ---------- */
  let dictating = false;
  let partialTimer = null;

  function voiceApi() {
    return (window.pywebview && window.pywebview.api && window.pywebview.api.voice_start)
      ? window.pywebview.api : null;
  }

  function setMicUI(on) {
    const b = document.getElementById('btn-voice');
    b.classList.toggle('recording', on);
    b.textContent = on ? '⏺ Идёт запись… нажмите, чтобы остановить' : '🎤 Диктовать описание';
  }

  async function toggleVoice() {
    const api = voiceApi();
    if (!api) {
      toast('Голосовой ввод работает в приложении (.exe / Запустить.bat)');
      return;
    }
    if (!dictating) {
      const ok = await api.voice_start();
      if (!ok) { toast('Микрофон недоступен: ' + (await api.voice_status())); return; }
      dictating = true;
      setMicUI(true);
      // живой предпросмотр распознаваемого текста
      partialTimer = setInterval(async () => {
        const p = await api.voice_partial();
        if (p) document.getElementById('description').value = p;
      }, 400);
    } else {
      clearInterval(partialTimer);
      const text = await api.voice_stop();
      dictating = false;
      setMicUI(false);
      if (text) {
        document.getElementById('description').value = text;
        buildFromDescription();
        toast('Распознано голосом → портрет собран');
      } else {
        toast('Речь не распознана');
      }
    }
  }

  // Доступность голоса определяется после готовности моста pywebview.
  function initVoiceAvailability() {
    const b = document.getElementById('btn-voice');
    const check = async () => {
      const api = voiceApi();
      if (!api) {
        b.classList.add('disabled');
        b.title = 'Доступно в нативном приложении (.exe). В браузере микрофонный офлайн-ввод отключён.';
        return;
      }
      const ok = await api.voice_available();
      b.classList.toggle('disabled', !ok);
      b.title = ok ? 'Офлайн-распознавание речи (Vosk, русский)'
                   : 'Модель распознавания не найдена: ' + (await api.voice_status());
    };
    window.addEventListener('pywebviewready', check);
    check();
  }

  let lastEvidence = [];
  let nluToken = 0; // отменяет устаревшее обогащение, если описание сменилось

  function buildFromDescription() {
    state.description = document.getElementById('description').value;
    const res = FC.extract.extract(state.description);
    Object.keys(res.values).forEach((k) => { state.profile.values[k] = res.values[k]; });
    Object.keys(res.params).forEach((k) => { state.profile.params[k] = res.params[k]; });
    res.marks.forEach((m) => { if (state.profile.marks.indexOf(m) === -1) state.profile.marks.push(m); });
    lastEvidence = res.evidence.slice();
    FC.ui.sync(state.profile);
    FC.ui.renderEvidence(lastEvidence, state.description);
    render();
    pushHistory();
    enrichWithNLU(res, state.description); // локальный нейро-fallback (если доступен)
    return res;
  }

  // Мост к локальному матчеру (nlu.py). Доступен только в нативном приложении —
  // как и голос. В чистом браузере отсутствует, и сценарий работает на регекспах.
  function interpretApi() {
    return (window.pywebview && window.pywebview.api && window.pywebview.api.interpret)
      ? window.pywebview.api : null;
  }

  /*
   * Гибрид: регекспы (extract.js) уже отработали и выставили уверенные признаки.
   * NLU дополняет ТОЛЬКО то, что регекспы не распознали, — правило «явное правило
   * побеждает» сохраняет объяснимость. Категории/приметы, уже выставленные
   * регекспом, не трогаем; для ползунков — не перетираем заданные регекспом.
   */
  async function enrichWithNLU(regexRes, descAtCall) {
    const api = interpretApi();
    if (!api) return;
    const myToken = ++nluToken;
    let res;
    try {
      res = await api.interpret(descAtCall, FC.traits.nluSchema());
    } catch (e) {
      return; // молча: NLU — необязательный слой
    }
    // описание успело смениться — результат устарел
    if (myToken !== nluToken || descAtCall !== state.description) return;
    if (!res) return;

    const coveredSel = new Set(regexRes.evidence.filter((e) => e.trait !== 'mark').map((e) => e.trait));
    const coveredMark = new Set(regexRes.marks);
    const added = [];

    Object.keys(res.values || {}).forEach((k) => {
      if (coveredSel.has(k)) return;            // регекс уже выставил — не трогаем
      state.profile.values[k] = res.values[k];
      added.push(evOf(res, 'select', k));
    });
    Object.keys(res.params || {}).forEach((k) => {
      if (coveredSel.has(k) || (k in regexRes.params)) return;
      state.profile.params[k] = res.params[k];
      added.push(evOf(res, 'param', k));
    });
    (res.marks || []).forEach((m) => {
      if (coveredMark.has(m)) return;
      if (state.profile.marks.indexOf(m) === -1) state.profile.marks.push(m);
      added.push(evOf(res, 'mark', m));
    });

    const real = added.filter(Boolean);
    if (!real.length) return;
    lastEvidence = lastEvidence.concat(real);
    FC.ui.sync(state.profile);
    FC.ui.renderEvidence(lastEvidence, state.description);
    render();
    pushHistory();
  }

  // Достать запись evidence из ответа NLU по типу и ключу/значению.
  function evOf(res, kind, key) {
    return (res.evidence || []).find((e) =>
      (kind === 'mark') ? (e.trait === 'mark' && e.value === key) : (e.trait === key)
    ) || null;
  }

  /* ---------- версии ---------- */
  function saveVersion() {
    const name = 'Версия ' + (state.versions.length + 1);
    state.versions.push({
      id: 'v-' + Date.now().toString(36),
      name: name,
      createdAt: new Date().toISOString(),
      profile: JSON.parse(JSON.stringify(state.profile)),
      comment: '',
    });
    FC.ui.renderVersions(state.versions, restoreVersion);
    persist();
    toast('Сохранена ' + name);
  }
  function restoreVersion(v) {
    state.profile = JSON.parse(JSON.stringify(v.profile));
    FC.ui.sync(state.profile);
    render();
    pushHistory();
    toast('Восстановлена ' + v.name);
  }

  /* ---------- проекты ---------- */
  function persist() {
    state.title = document.getElementById('case-title').value;
    state.operator = document.getElementById('case-operator').value;
    state.subjectType = document.getElementById('case-subject').value;
    state.description = document.getElementById('description').value;
    FC.store.saveCase(state);
  }
  function openProjects() {
    FC.ui.renderProjects(FC.store.listCases(), {
      onOpen: (id) => {
        const c = FC.store.loadCase(id);
        if (c) { state = normalize(c); syncMeta(); render(); historyInit(); toggleProjects(false); toast('Открыт проект'); }
      },
      onDelete: (id) => { FC.store.deleteCase(id); openProjects(); },
    });
    toggleProjects(true);
  }
  function toggleProjects(show) {
    document.getElementById('projects-overlay').style.display = show ? 'flex' : 'none';
  }

  // подстраховка на случай старых/частичных карточек
  function normalize(c) {
    const base = newCaseState();
    c.profile = c.profile || base.profile;
    c.profile.values = Object.assign({}, base.profile.values, c.profile.values || {});
    c.profile.params = Object.assign({}, base.profile.params, c.profile.params || {});
    c.profile.marks = c.profile.marks || [];
    c.versions = c.versions || [];
    return c;
  }

  /* ---------- подбор лиц (итеративное сближение «выбери похожее») ----------
   * Два входа в один механизм:
   *   • «по описанию» — центр берётся из разобранного текста, названные признаки
   *     фиксируются замком, галерея варьирует только неупомянутое;
   *   • «выбери похожее» — старт от текущего портрета без замков.
   */
  let evolveState = null;

  // Открыть подбор. opts.fromDescription=true → режим «по описанию» с замками.
  function openEvolve(opts) {
    opts = opts || {};
    const desc = !!opts.fromDescription;
    const radius = desc ? 0.95 : (parseFloat(document.getElementById('evolve-radius').value) || 0.8);
    const lockKeys = desc ? [...FC.evolve.locksFromEvidence(lastEvidence)] : [];
    evolveState = {
      mode: desc ? 'desc' : 'manual',
      center: FC.evolve.clone(state.profile),
      radius: radius, gen: 1, cells: [], selected: new Set(),
      lockKeys: lockKeys, locks: new Set(lockKeys),
      history: [], // прошлые поколения: {gen, radius, center} — для отката и веток
    };
    document.getElementById('evolve-radius').value = radius;
    applyEvolveMode();
    renderEvolveLocks();
    renderEvolveGrid();
    renderEvolveHistory();
    document.getElementById('evolve-overlay').style.display = 'flex';
  }
  function closeEvolve() { document.getElementById('evolve-overlay').style.display = 'none'; }

  function applyEvolveMode() {
    const title = document.getElementById('evolve-title');
    const sub = document.getElementById('evolve-subtitle');
    if (evolveState.mode === 'desc') {
      title.textContent = 'Подбор лица по описанию';
      sub.textContent = 'Лица собраны по вашему описанию. Зафиксированные признаки (замки ниже) не меняются — снимите замок, чтобы признак тоже варьировался. Отметьте 1–2 наиболее похожих и нажмите «Новое поколение».';
    } else {
      title.textContent = 'Подбор лица — «выбери похожее»';
      sub.textContent = 'Отметьте 1–2 наиболее похожих варианта и нажмите «Новое поколение» — система сблизится к цели. «Применить» перенесёт выбранный вариант в портрет.';
    }
  }

  // Подпись замка: «Нос: Прямой» для категорий, имя ползунка для числовых.
  function lockLabel(key) {
    const sd = FC.traits.selectDef(key);
    if (sd) return sd.label + ': ' + FC.traits.optionLabel(key, evolveState.center.values[key]);
    const sl = FC.traits.SLIDERS.find((s) => s.key === key);
    return sl ? sl.label : key;
  }

  function renderEvolveLocks() {
    const host = document.getElementById('evolve-locks');
    if (!host) return;
    host.innerHTML = '';
    if (evolveState.mode !== 'desc' || !evolveState.lockKeys.length) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';
    host.appendChild(Object.assign(document.createElement('span'),
      { className: 'locks-title', textContent: 'Из описания зафиксировано:' }));
    evolveState.lockKeys.forEach((key) => {
      const chip = document.createElement('button');
      const on = evolveState.locks.has(key);
      chip.className = 'lock-chip' + (on ? '' : ' off');
      chip.innerHTML = (on ? '🔒 ' : '🔓 ') + lockLabel(key);
      chip.title = on ? 'Признак зафиксирован — нажмите, чтобы он тоже варьировался'
                      : 'Признак варьируется — нажмите, чтобы зафиксировать';
      chip.addEventListener('click', () => {
        if (evolveState.locks.has(key)) evolveState.locks.delete(key);
        else evolveState.locks.add(key);
        renderEvolveLocks();
        renderEvolveGrid();
      });
      host.appendChild(chip);
    });
  }

  function renderEvolveGrid() {
    hideCompare(); // регенерация галереи всегда возвращает к сетке
    const host = document.getElementById('evolve-grid');
    host.innerHTML = '';
    evolveState.cells = FC.evolve.generation(evolveState.center, evolveState.radius, 9, evolveState.locks);
    evolveState.selected = new Set();
    const anchorTag = evolveState.mode === 'desc' ? 'по описанию' : 'текущий';
    evolveState.cells.forEach((prof, i) => {
      const card = document.createElement('div');
      card.className = 'evolve-card';
      card.innerHTML = FC.render.buildSVG(prof) +
        (i === 0 ? '<span class="tag">' + anchorTag + '</span>' : '') +
        '<span class="pick">✓</span>';
      card.addEventListener('click', () => {
        if (evolveState.selected.has(i)) { evolveState.selected.delete(i); card.classList.remove('selected'); }
        else { evolveState.selected.add(i); card.classList.add('selected'); }
      });
      host.appendChild(card);
    });
    document.getElementById('evolve-gen').textContent =
      'Поколение ' + evolveState.gen + ' · сила ' + evolveState.radius.toFixed(2);
  }

  function evolveNext() {
    const sel = [...evolveState.selected].map((i) => evolveState.cells[i]);
    // Текущее поколение уходит в историю ДО перехода к следующему — так к нему
    // всегда можно вернуться и продолжить подбор в другую сторону (новая ветка).
    evolveState.history.push({
      gen: evolveState.gen, radius: evolveState.radius,
      center: FC.evolve.clone(evolveState.center),
    });
    if (sel.length) {
      evolveState.center = FC.evolve.average(sel, evolveState.locks);
      evolveState.radius = Math.max(0.2, evolveState.radius * 0.72); // сужаем разброс
      document.getElementById('evolve-radius').value = evolveState.radius;
    }
    evolveState.gen += 1;
    renderEvolveLocks(); // подписи замков зависят от центра — мог измениться
    renderEvolveGrid();
    renderEvolveHistory();
  }

  function evolveMore() {
    evolveState.radius = parseFloat(document.getElementById('evolve-radius').value) || evolveState.radius;
    renderEvolveGrid();
  }

  // Полоса истории поколений: клик по прошлому шагу откатывает подбор к нему
  // и обрезает всё, что шло после, — дальше пойдёт новая ветка от этой точки.
  function renderEvolveHistory() {
    const host = document.getElementById('evolve-history');
    if (!host) return;
    if (!evolveState.history.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = 'flex';
    host.innerHTML = '<span class="hist-title">История:</span>';
    evolveState.history.forEach((h, idx) => {
      const item = document.createElement('div');
      item.className = 'hist-item';
      item.innerHTML = FC.render.buildSVG(h.center) + '<span class="hist-lab">Пок. ' + h.gen + '</span>';
      item.title = 'Вернуться к поколению ' + h.gen;
      item.addEventListener('click', () => jumpToEvolveHistory(idx));
      host.appendChild(item);
      const arrow = document.createElement('span');
      arrow.className = 'hist-arrow'; arrow.textContent = '→';
      host.appendChild(arrow);
    });
    const cur = document.createElement('div');
    cur.className = 'hist-item current';
    cur.innerHTML = FC.render.buildSVG(evolveState.center) + '<span class="hist-lab">Пок. ' + evolveState.gen + '</span>';
    cur.title = 'Текущее поколение';
    host.appendChild(cur);
  }

  function jumpToEvolveHistory(idx) {
    const h = evolveState.history[idx];
    evolveState.center = FC.evolve.clone(h.center);
    evolveState.radius = h.radius;
    evolveState.gen = h.gen;
    evolveState.history = evolveState.history.slice(0, idx); // остальное — новая ветка
    document.getElementById('evolve-radius').value = evolveState.radius;
    renderEvolveLocks();
    renderEvolveGrid();
    renderEvolveHistory();
    toast('Возврат к поколению ' + h.gen + ' — дальше пойдёт новая ветка подбора');
  }

  /* ---------- сравнение вариантов крупным планом ---------- */
  function toggleGridControls(show) {
    const c = document.querySelector('.evolve-controls');
    if (c) c.style.display = show ? '' : 'none';
  }
  function hideCompare() {
    const cmp = document.getElementById('evolve-compare');
    if (cmp) cmp.style.display = 'none';
    const grid = document.getElementById('evolve-grid');
    if (grid) grid.style.display = '';
    toggleGridControls(true);
  }
  // Показать 1–2 отмеченных варианта крупно рядом с текущим рабочим портретом —
  // свидетелю проще решить, какой ближе к образу, без отвлекающих 6 других лиц.
  function showCompare() {
    const sel = [...evolveState.selected];
    if (!sel.length) { toast('Отметьте 1–2 варианта для сравнения'); return; }
    const faces = [{ label: 'Текущий портрет', prof: state.profile, ref: true }];
    sel.slice(0, 2).forEach((i, k) => faces.push({ label: 'Вариант ' + (k + 1), prof: evolveState.cells[i], idx: i }));
    const host = document.getElementById('evolve-compare');
    host.innerHTML =
      '<div class="cmp-head"><button id="btn-cmp-back" class="tb">← К галерее</button>' +
      '<span class="muted">Сравнение крупным планом. «Применить» перенесёт вариант в рабочий портрет.</span></div>' +
      '<div class="cmp-row">' + faces.map((f) =>
        '<div class="cmp-card' + (f.ref ? ' ref' : '') + '">' +
          '<div class="cmp-lab">' + f.label + '</div>' +
          FC.render.buildSVG(f.prof) +
          (f.ref ? '' : '<button class="tb cmp-apply" data-i="' + f.idx + '">Применить этот ▸</button>') +
        '</div>').join('') + '</div>';
    document.getElementById('btn-cmp-back').addEventListener('click', hideCompare);
    host.querySelectorAll('.cmp-apply').forEach((b) => b.addEventListener('click', () => {
      const i = parseInt(b.getAttribute('data-i'), 10);
      state.profile = FC.evolve.clone(evolveState.cells[i]);
      FC.ui.sync(state.profile); render(); pushHistory(); closeEvolve();
      toast('Вариант применён — доработайте чертами справа');
    }));
    document.getElementById('evolve-grid').style.display = 'none';
    host.style.display = '';
    toggleGridControls(false);
  }

  function evolveApply() {
    const sel = [...evolveState.selected];
    let chosen;
    if (sel.length === 1) chosen = evolveState.cells[sel[0]];
    else if (sel.length > 1) chosen = FC.evolve.average(sel.map((i) => evolveState.cells[i]), evolveState.locks);
    else chosen = evolveState.center;
    state.profile = FC.evolve.clone(chosen);
    FC.ui.sync(state.profile);
    render();
    pushHistory();
    closeEvolve();
    toast('Вариант применён — доработайте чертами справа');
  }

  // Вход «по описанию»: гарантируем, что портрет/evidence собраны из текста.
  function suggestFromDescription() {
    const text = document.getElementById('description').value.trim();
    if (!text) { toast('Сначала введите описание внешности'); return; }
    if (text !== state.description || !lastEvidence.length) buildFromDescription();
    if (!FC.evolve.locksFromEvidence(lastEvidence).size) {
      toast('В описании не распознано опорных черт — подбор пойдёт свободно');
    }
    openEvolve({ fromDescription: true });
  }

  function currentSVG(transparent) {
    return FC.render.buildSVG(state.profile, { transparent: !!transparent });
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.opacity = '0'; }, 1800);
  }

  function bindToolbar() {
    document.getElementById('btn-extract').addEventListener('click', buildFromDescription);
    document.getElementById('btn-voice').addEventListener('click', toggleVoice);
    document.getElementById('btn-save-version').addEventListener('click', saveVersion);
    document.getElementById('btn-new').addEventListener('click', () => {
      if (confirm('Создать новую карточку? Несохранённые изменения будут потеряны.')) {
        state = newCaseState(); syncMeta(); render(); historyInit();
      }
    });
    document.getElementById('btn-save-project').addEventListener('click', () => { persist(); toast('Проект сохранён локально'); });
    document.getElementById('btn-projects').addEventListener('click', openProjects);
    document.getElementById('btn-close-projects').addEventListener('click', () => toggleProjects(false));
    document.getElementById('btn-export-sheet').addEventListener('click', () => {
      persist();
      const meta = {
        title: state.title,
        operator: state.operator,
        subjectType: state.subjectType,
        date: new Date(state.createdAt).toLocaleDateString('ru-RU'),
        description: state.description,
      };
      const svg = FC.report.buildSheetSVG(state.profile, meta);
      FC.store.exportRasterPNG(svg, FC.report.W, FC.report.H,
        FC.store.safeName(state.title) + '_ориентировка.png', 2);
      toast('Лист-ориентировка сохранён');
    });
    document.getElementById('btn-export-png').addEventListener('click', () => {
      persist();
      FC.store.exportPNG(currentSVG(false), FC.store.safeName(state.title) + '.png', 2);
    });
    document.getElementById('btn-export-svg').addEventListener('click', () => {
      FC.store.exportSVG(currentSVG(true), FC.store.safeName(state.title) + '.svg');
    });
    document.getElementById('btn-export-json').addEventListener('click', () => { persist(); FC.store.exportCaseJSON(state); });
    document.getElementById('file-import').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      FC.store.importCaseJSON(f).then((c) => { state = normalize(c); syncMeta(); render(); historyInit(); toast('Проект загружен'); })
        .catch(() => alert('Не удалось прочитать файл'));
      e.target.value = '';
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      state.profile = FC.traits.defaultProfile(); FC.ui.sync(state.profile); render(); pushHistory();
    });
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    document.getElementById('btn-evolve').addEventListener('click', () => openEvolve());
    document.getElementById('btn-suggest').addEventListener('click', suggestFromDescription);
    document.getElementById('btn-close-evolve').addEventListener('click', closeEvolve);
    document.getElementById('btn-evolve-next').addEventListener('click', evolveNext);
    document.getElementById('btn-evolve-random').addEventListener('click', evolveMore);
    document.getElementById('btn-evolve-compare').addEventListener('click', showCompare);
    document.getElementById('btn-evolve-apply').addEventListener('click', evolveApply);
    document.getElementById('evolve-radius').addEventListener('change', () => {
      if (evolveState) { evolveState.radius = parseFloat(document.getElementById('evolve-radius').value); renderEvolveGrid(); }
    });
  }

  function init() {
    state = newCaseState();
    FC.ui.mount(handlers);
    bindToolbar();
    buildPresets();
    initVoiceAvailability();
    syncMeta();
    render();
    historyInit();
    FC.ui.renderEvidence([]);
  }

  document.addEventListener('DOMContentLoaded', init);
  FC.app = { getState: () => state };
})(window.FC = window.FC || {});
