/*
 * report.js — печатный лист «ориентировки».
 *
 * Собирает официальный A4-лист (SVG): шапка, портрет в рамке, данные дела,
 * перечень признаков внешности, словесное описание и дисклеймер. Это закрывает
 * требование MVP про экспорт для печати и придаёт результату вид документа,
 * а не просто картинки лица.
 */
(function (FC) {
  'use strict';

  const W = 820, H = 1160; // пропорции, близкие к A4-портрет

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Простой перенос по словам под фиксированную ширину строки (в символах).
  function wrap(text, max) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach((w) => {
      if ((cur + ' ' + w).trim().length > max) {
        if (cur) lines.push(cur);
        cur = w;
      } else {
        cur = (cur ? cur + ' ' : '') + w;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  const SUBJ = { suspect: 'Разыскиваемый', missing: 'Пропавший без вести', other: 'Иное' };

  function traitRows(profile) {
    return FC.traits.SELECTS.map((d) => [d.label, FC.traits.optionLabel(d.key, profile.values[d.key])]);
  }

  function buildSheetSVG(profile, meta) {
    meta = meta || {};
    let s = '';

    // фон и рамка
    s += '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    s += '<rect x="14" y="14" width="' + (W - 28) + '" height="' + (H - 28) + '" fill="none" stroke="#1c222b" stroke-width="2"/>';

    // шапка
    s += '<text x="' + (W / 2) + '" y="58" text-anchor="middle" font-size="29" font-weight="700" fill="#14181f" letter-spacing="1">ОРИЕНТИРОВОЧНЫЙ ПОРТРЕТ</text>';
    s += '<text x="' + (W / 2) + '" y="82" text-anchor="middle" font-size="13" fill="#666">составлен со слов · не является фотографией</text>';
    s += '<line x1="30" y1="98" x2="' + (W - 30) + '" y2="98" stroke="#1c222b" stroke-width="1.5"/>';

    // портрет в рамке
    s += '<rect x="46" y="118" width="348" height="487" fill="#f3f1ec" stroke="#999" stroke-width="1"/>';
    s += '<svg x="46" y="118" width="348" height="487" viewBox="0 0 ' + FC.render.VIEW_W + ' ' + FC.render.VIEW_H + '">' +
      FC.render.buildSVG(profile, { bare: true, transparent: true }) + '</svg>';
    s += '<text x="220" y="626" text-anchor="middle" font-size="12" fill="#777">Иллюстративная реконструкция</text>';

    // правая колонка: данные + признаки
    const x = 430;
    let y = 142;
    const label = (t) => { const r = '<text x="' + x + '" y="' + y + '" font-size="15" font-weight="700" fill="#14181f">' + esc(t) + '</text>'; y += 25; return r; };
    const row = (k, v) => { const r = '<text x="' + x + '" y="' + y + '" font-size="13.5" fill="#222"><tspan fill="#8a8a8a">' + esc(k) + ': </tspan>' + esc(v) + '</text>'; y += 20; return r; };

    s += label('ДАННЫЕ');
    s += row('Дело', meta.title || '—');
    s += row('Тип', SUBJ[meta.subjectType] || '—');
    s += row('Оператор', meta.operator || '—');
    s += row('Дата', meta.date || new Date().toLocaleDateString('ru-RU'));
    y += 10;
    s += label('ПРИЗНАКИ ВНЕШНОСТИ');
    traitRows(profile).forEach((t) => { s += row(t[0], t[1]); });
    const marks = (profile.marks || []).map((mk) => {
      const m = FC.traits.MARKS.find((z) => z.value === mk);
      return m ? m.label : mk;
    });
    if (marks.length) { y += 4; s += row('Особые приметы', marks.join(', ')); }

    // словесное описание (на всю ширину)
    const by = 690;
    s += '<text x="46" y="' + (by - 9) + '" font-size="15" font-weight="700" fill="#14181f">СЛОВЕСНОЕ ОПИСАНИЕ</text>';
    s += '<rect x="46" y="' + by + '" width="' + (W - 92) + '" height="400" fill="#fafafa" stroke="#cfcfcf" stroke-width="1"/>';
    wrap(meta.description || '(описание не введено)', 96).slice(0, 17).forEach((ln, i) => {
      s += '<text x="62" y="' + (by + 28 + i * 22) + '" font-size="14" fill="#222">' + esc(ln) + '</text>';
    });

    // подвал
    s += '<text x="' + (W / 2) + '" y="' + (H - 30) + '" text-anchor="middle" font-size="11" fill="#888">' +
      'Инструмент помощи оператору. Изображение ориентировочное и не предназначено для автоматической идентификации личности.</text>';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
      'width="100%" height="100%" font-family="Segoe UI, Arial, sans-serif" stroke-linejoin="round">' + s + '</svg>';
  }

  FC.report = { buildSheetSVG: buildSheetSVG, W: W, H: H };
})(window.FC = window.FC || {});
