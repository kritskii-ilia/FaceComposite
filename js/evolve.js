/*
 * evolve.js — итеративный подбор лица методом «выбери похожее».
 *
 * Реализует whole-face refinement (подход EvoFIT/EFIT-V): вместо правки отдельных
 * черт оператор/свидетель видит популяцию вариаций целого лица, отмечает наиболее
 * похожие, и система сближается к цели, сужая разброс вокруг выбранного.
 *
 * Это закрывает пункт этапа 2 из брифа: «несколько стартовых вариантов» +
 * «выбор более похожих» + «постепенное улучшение». Параметрический движок делает
 * это естественным: вариация = шум по числовым параметрам + редкая мутация формы.
 */
(function (FC) {
  'use strict';

  function clone(p) { return JSON.parse(JSON.stringify(p)); }

  // нормальное распределение (Box–Muller)
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // locks — набор ключей (Set или массив), которые НЕ варьируются.
  function isLocked(locks, key) {
    if (!locks) return false;
    return locks.has ? locks.has(key) : locks.indexOf(key) !== -1;
  }

  // Эволюционируем «трудновербализуемую» геометрию; пол/возраст/кожу/волосы/
  // растительность/очки/цвет глаз держим стабильными — их обычно называют словами.
  const EVOLVE_CATS = ['faceShape', 'chinLine', 'eyes', 'eyebrows', 'nose', 'lips', 'ears'];

  // Признаки, названные в описании, фиксируем замком: галерея кандидатов варьирует
  // только то, что свидетель НЕ упомянул. Из evidence (extract.js) берём лишь те
  // ключи, которые вообще участвуют в вариации, — иначе замок был бы пустышкой.
  function locksFromEvidence(evidence) {
    const evolvable = new Set(EVOLVE_CATS.concat(FC.traits.SLIDERS.map((s) => s.key)));
    const locks = new Set();
    (evidence || []).forEach((ev) => {
      if (ev.trait !== 'mark' && evolvable.has(ev.trait)) locks.add(ev.trait);
    });
    return locks;
  }

  function perturb(profile, radius, locks) {
    const p = clone(profile);
    FC.traits.SLIDERS.forEach((s) => {
      if (isLocked(locks, s.key)) return;
      const sigma = (s.max - s.min) * 0.12 * radius;
      let v = (p.params[s.key] != null ? p.params[s.key] : s.default) + gauss() * sigma;
      v = Math.round(v / s.step) * s.step;
      p.params[s.key] = clamp(v, s.min, s.max);
    });
    EVOLVE_CATS.forEach((key) => {
      if (isLocked(locks, key)) return;
      const def = FC.traits.selectDef(key);
      if (!def) return;
      if (Math.random() < 0.16 * radius) {
        const opts = def.options.filter((o) => o.value !== p.values[key]);
        if (opts.length) p.values[key] = opts[Math.floor(Math.random() * opts.length)].value;
      }
    });
    return p;
  }

  // «Скрещивание»: усреднение параметров выбранных + мода по форме.
  // Замкнутые признаки не пересчитываем — оставляем значение опорного профиля.
  function average(profiles, locks) {
    const base = clone(profiles[0]);
    FC.traits.SLIDERS.forEach((s) => {
      if (isLocked(locks, s.key)) return;
      let sum = 0;
      profiles.forEach((pr) => { sum += (pr.params[s.key] != null ? pr.params[s.key] : s.default); });
      let v = sum / profiles.length;
      v = Math.round(v / s.step) * s.step;
      base.params[s.key] = clamp(v, s.min, s.max);
    });
    EVOLVE_CATS.forEach((key) => {
      if (isLocked(locks, key)) return;
      const counts = {};
      profiles.forEach((pr) => { const val = pr.values[key]; counts[val] = (counts[val] || 0) + 1; });
      let best = base.values[key], bc = -1;
      Object.keys(counts).forEach((k) => { if (counts[k] > bc) { bc = counts[k]; best = k; } });
      base.values[key] = best;
    });
    return base;
  }

  // Поколение: первая клетка — опорная (центр), остальные — вариации.
  function generation(center, radius, n, locks) {
    const out = [clone(center)];
    for (let i = 1; i < n; i++) out.push(perturb(center, radius, locks));
    return out;
  }

  FC.evolve = {
    perturb: perturb, average: average, generation: generation, clone: clone,
    EVOLVE_CATS: EVOLVE_CATS, locksFromEvidence: locksFromEvidence, isLocked: isLocked,
  };
})(window.FC = window.FC || {});
