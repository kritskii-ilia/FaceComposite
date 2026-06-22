/*
 * ui.js — построение панелей управления из таксономии признаков.
 * Чистые DOM-строители; вся логика состояния живёт в app.js и передаётся
 * сюда через объект handlers.
 */
(function (FC) {
  'use strict';

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function groupBy(list) {
    const map = {};
    list.forEach((it) => { (map[it.group] = map[it.group] || []).push(it); });
    return map;
  }

  let H = null; // handlers

  function mount(handlers) {
    H = handlers;
    buildSelects();
    buildSliders();
    buildMarks();
  }

  function buildSelects() {
    const host = document.getElementById('selects');
    host.innerHTML = '';
    const groups = groupBy(FC.traits.SELECTS);
    Object.keys(groups).forEach((g) => {
      const fs = el('div', 'panel-group');
      fs.appendChild(el('h4', null, g));
      groups[g].forEach((def) => {
        const row = el('label', 'ctl-row');
        row.appendChild(el('span', 'ctl-label', def.label));
        const sel = el('select');
        sel.id = 'ctl-' + def.key;
        def.options.forEach((o) => {
          const opt = el('option');
          opt.value = o.value; opt.textContent = o.label;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => H.onTrait(def.key, sel.value));
        row.appendChild(sel);
        fs.appendChild(row);
      });
      host.appendChild(fs);
    });
  }

  function buildSliders() {
    const host = document.getElementById('sliders');
    host.innerHTML = '';
    const groups = groupBy(FC.traits.SLIDERS);
    Object.keys(groups).forEach((g) => {
      const fs = el('div', 'panel-group');
      fs.appendChild(el('h4', null, g));
      groups[g].forEach((def) => {
        const row = el('div', 'slider-row');
        const lab = el('span', 'ctl-label', def.label);
        const rng = el('input');
        rng.type = 'range'; rng.id = 'ctl-' + def.key;
        rng.min = def.min; rng.max = def.max; rng.step = def.step;
        rng.addEventListener('input', () => H.onParam(def.key, parseFloat(rng.value)));
        row.appendChild(lab);
        row.appendChild(rng);
        fs.appendChild(row);
      });
      host.appendChild(fs);
    });
  }

  function buildMarks() {
    const host = document.getElementById('marks');
    host.innerHTML = '';
    const fs = el('div', 'panel-group');
    fs.appendChild(el('h4', null, 'Особые приметы'));
    FC.traits.MARKS.forEach((m) => {
      const row = el('label', 'check-row');
      const cb = el('input'); cb.type = 'checkbox'; cb.id = 'mark-' + m.value;
      cb.addEventListener('change', () => H.onMark(m.value, cb.checked));
      row.appendChild(cb);
      row.appendChild(el('span', null, m.label));
      fs.appendChild(row);
    });
    host.appendChild(fs);
  }

  // Привести значения контролов к текущему профилю (после извлечения/загрузки).
  function sync(profile) {
    FC.traits.SELECTS.forEach((def) => {
      const e = document.getElementById('ctl-' + def.key);
      if (e) e.value = profile.values[def.key];
    });
    FC.traits.SLIDERS.forEach((def) => {
      const e = document.getElementById('ctl-' + def.key);
      if (e) e.value = profile.params[def.key];
    });
    FC.traits.MARKS.forEach((m) => {
      const e = document.getElementById('mark-' + m.value);
      if (e) e.checked = (profile.marks || []).indexOf(m.value) !== -1;
    });
  }

  // Подпись уровня уверенности распознавания (объяснимость для оператора).
  const CONF = {
    high: { label: 'уверенно', cls: 'conf-high' },
    med: { label: 'вероятно', cls: 'conf-med' },
    low: { label: 'предположительно', cls: 'conf-low' },
  };

  function evidenceLabel(ev) {
    if (ev.trait === 'mark') {
      const m = FC.traits.MARKS.find((x) => x.value === ev.value);
      return m ? m.label : ev.value;
    }
    if (FC.traits.selectDef(ev.trait)) {
      return FC.traits.selectDef(ev.trait).label + ': ' + FC.traits.optionLabel(ev.trait, ev.value);
    }
    // числовой признак — человекочитаемо, без «сырого» множителя
    const sl = FC.traits.SLIDERS.find((s) => s.key === ev.trait);
    if (sl) return sl.label + ': ' + (ev.value > sl.default ? 'больше обычного' : 'меньше обычного');
    return ev.trait + ': ' + ev.value;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Подсветка фрагментов описания, по которым выставлены признаки: цвет = уверенность,
  // приглушённый текст = слова, которые система не распознала. Перекрытия пропускаются.
  function highlightDescription(text, evidence) {
    const low = text.toLowerCase();
    const ivs = [];
    (evidence || []).forEach((ev) => {
      const frag = (ev.match || '').toLowerCase().trim();
      if (!frag) return;
      const idx = low.indexOf(frag);
      if (idx === -1) return;
      ivs.push({ s: idx, e: idx + frag.length, conf: (ev.conf || 'high') });
    });
    ivs.sort((a, b) => a.s - b.s || b.e - a.e);
    let out = '', pos = 0;
    ivs.forEach((iv) => {
      if (iv.s < pos) return;
      out += escapeHtml(text.slice(pos, iv.s));
      const cls = iv.conf === 'high' ? 'hl-high' : 'hl-med';
      out += '<mark class="hl ' + cls + '">' + escapeHtml(text.slice(iv.s, iv.e)) + '</mark>';
      pos = iv.e;
    });
    out += escapeHtml(text.slice(pos));
    return out;
  }

  function renderEvidence(evidence, description) {
    const host = document.getElementById('evidence');
    if (!evidence || !evidence.length) {
      host.innerHTML = '<div class="muted">Признаки пока не распознаны. Введите описание и нажмите «Собрать по описанию».</div>';
      return;
    }
    const parse = (description && description.trim())
      ? '<div class="desc-parse">' + highlightDescription(description, evidence) + '</div>' : '';
    const med = evidence.filter((e) => (e.conf || 'high') !== 'high').length;
    host.innerHTML = parse + '<div class="ev-title">Распознано (' + evidence.length + ')' +
      (med ? ' · <span class="conf-dot conf-med"></span>' + med + ' оценочно' : '') + ':</div>';
    evidence.forEach((ev) => {
      const conf = CONF[ev.conf || 'high'] || CONF.high;
      const chip = el('div', 'ev-chip');
      chip.innerHTML = '<span class="conf-dot ' + conf.cls + '" title="' + conf.label + '"></span>' +
        '<b>' + evidenceLabel(ev) + '</b> <span class="muted">← «' + ev.match + '»</span> ' +
        '<span class="conf-tag ' + conf.cls + '">' + conf.label + '</span>';
      host.appendChild(chip);
    });
  }

  function renderVersions(versions, onPick) {
    const host = document.getElementById('versions');
    host.innerHTML = '';
    if (!versions.length) { host.innerHTML = '<div class="muted">Версий пока нет.</div>'; return; }
    versions.slice().reverse().forEach((v) => {
      const row = el('div', 'version-row');
      row.innerHTML = '<b>' + v.name + '</b><br><span class="muted">' +
        new Date(v.createdAt).toLocaleString('ru-RU') + '</span>';
      row.addEventListener('click', () => onPick(v));
      host.appendChild(row);
    });
  }

  function renderProjects(cases, handlers) {
    const host = document.getElementById('projects-list');
    host.innerHTML = '';
    const ids = Object.keys(cases);
    if (!ids.length) { host.innerHTML = '<div class="muted">Сохранённых проектов нет.</div>'; return; }
    ids.map((id) => cases[id]).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .forEach((c) => {
        const row = el('div', 'project-row');
        row.innerHTML = '<div><b>' + (c.title || 'Без названия') + '</b><br>' +
          '<span class="muted">' + (c.versions ? c.versions.length : 0) + ' верс. · ' +
          new Date(c.updatedAt || c.createdAt).toLocaleString('ru-RU') + '</span></div>';
        const open = el('button', 'mini', 'Открыть');
        open.addEventListener('click', () => handlers.onOpen(c.id));
        const del = el('button', 'mini danger', 'Удалить');
        del.addEventListener('click', () => handlers.onDelete(c.id));
        const btns = el('div', 'row-btns'); btns.appendChild(open); btns.appendChild(del);
        row.appendChild(btns);
        host.appendChild(row);
      });
  }

  FC.ui = {
    mount: mount, sync: sync, renderEvidence: renderEvidence,
    renderVersions: renderVersions, renderProjects: renderProjects,
  };
})(window.FC = window.FC || {});
