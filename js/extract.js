/*
 * extract.js — детерминированное извлечение признаков из свободного русского
 * описания. Это намеренно НЕ нейросеть: на первом операционном этапе важнее
 * объяснимость и контроль оператора (см. decision-log D-004).
 *
 * Каждое правило — пара {регэксп, признак, значение}. Правила для одного
 * признака идут от частного к общему; срабатывает первое. Возвращаем не только
 * значения, но и evidence (что и по какому совпадению выставлено) — этот список
 * на этапе 2 станет основой для confidence и подсветки в тексте.
 */
(function (FC) {
  'use strict';

  // [регэксп, ключ-признака, значение]
  const RULES = [
    // пол
    [/жен(щин|ск|\b)|девуш|девоч|дама/i, 'gender', 'female'],
    [/мужчин|муж(ско|чи)|парень|пацан|мальчик/i, 'gender', 'male'],
    // возраст (всегда оценка — отсюда уверенность «вероятно»)
    [/ребён|ребен|\bдет(и|ей|ск)/i, 'ageBand', 'child', 'med'],
    [/подрост|тинейдж/i, 'ageBand', 'teen', 'med'],
    [/пожил|престарел|стар(ик|ая|ый)|в годах/i, 'ageBand', 'senior', 'med'],
    [/средн\w*\s+возр|за сорок|под сорок|сорока?\s*лет|лет\s*сорок|лет\s*4[0-9]|4[0-9]\s*(лет|год)|45|50|пятьдес/i, 'ageBand', 'middle', 'med'],
    [/молод|юнош|\b(18|20|25)\s*лет|двадцат/i, 'ageBand', 'young', 'med'],
    [/тридцат|за тридцать|3[0-9]\s*(лет|год)|лет\s*3[0-9]/i, 'ageBand', 'adult', 'med'],
    // тон кожи
    [/очень тёмн\w*\s+кож|очень темн\w*\s+кож|чёрнокож|чернокож|тёмнокож|темнокож/i, 'skinTone', 'dark'],
    [/тёмн\w*\s+кож|темн\w*\s+кож/i, 'skinTone', 'brown'],
    [/смугл|загорел/i, 'skinTone', 'tan'],
    [/очень светл\w*\s+кож|бледн|белокож/i, 'skinTone', 'pale'],
    [/светл\w*\s+кож|светлокож/i, 'skinTone', 'light'],
    // форма лица
    [/оваль/i, 'faceShape', 'oval'],
    [/кругл\w*\s+лиц|круглолиц|округл\w*\s+лиц/i, 'faceShape', 'round'],
    [/квадратн\w*\s+лиц|квадратн\w*\s+форм/i, 'faceShape', 'square'],
    [/прямоуголь|удлинён\w*\s+лиц|удлинен\w*\s+лиц|вытянут\w*\s+лиц/i, 'faceShape', 'rectangular'],
    [/треуголь|сердцевид|сердечк/i, 'faceShape', 'heart'],
    [/ромбовид|ромб/i, 'faceShape', 'diamond'],
    // подбородок
    [/двойн\w*\s+подбород/i, 'chinLine', 'double'],
    [/(остр|заострён|заострен|узк)\w*\s+подбород|подбород\w*\s+(остр|клин)/i, 'chinLine', 'pointed'],
    [/(квадратн|массивн|волев|тяжёл|тяжел)\w*\s+подбород/i, 'chinLine', 'square'],
    [/мягк\w*\s+подбород/i, 'chinLine', 'soft'],
    // форма глаз
    [/раскос|узк\w*\s+глаз|щёлоч|прищур/i, 'eyes', 'narrow'],
    [/кругл\w*\s+глаз|глаз\w*\s+навыкате|больш\w*\s+круглы\w*\s+глаз/i, 'eyes', 'round'],
    [/нависш\w*\s+век/i, 'eyes', 'hooded'],
    [/миндал/i, 'eyes', 'almond'],
    // цвет глаз
    [/кар(и|е)\w*\s*глаз|кареглаз/i, 'eyeColor', 'brown'],
    [/голуб\w*\s+глаз|голубоглаз/i, 'eyeColor', 'blue'],
    [/зелён\w*\s+глаз|зелен\w*\s+глаз/i, 'eyeColor', 'green'],
    [/сер\w*\s+глаз|сероглаз/i, 'eyeColor', 'gray'],
    [/орехов\w*\s+глаз/i, 'eyeColor', 'hazel'],
    // брови
    [/густ\w*\s+бров|широк\w*\s+бров/i, 'eyebrows', 'thick'],
    [/тонк\w*\s+бров|узк\w*\s+бров/i, 'eyebrows', 'thin'],
    [/прям\w*\s+бров/i, 'eyebrows', 'straight'],
    [/дугообразн\w*\s+бров|изогнут\w*\s+бров/i, 'eyebrows', 'arched'],
    // нос
    [/горбин|орлин|с горб/i, 'nose', 'hooked'],
    [/курнос|вздёрнут|вздернут/i, 'nose', 'upturned'],
    [/картош|нос\w*\s+картош|пухл\w*\s+нос|широк\w*\s+ноздр|приплюснут|плоск\w*\s+нос/i, 'nose', 'snub'],
    [/широк\w*\s+нос/i, 'nose', 'wide'],
    [/узк\w*\s+нос|тонк\w*\s+нос/i, 'nose', 'narrow'],
    [/прям\w*\s+нос/i, 'nose', 'straight'],
    // губы
    [/тонк\w*\s+губ|узк\w*\s+губ/i, 'lips', 'thin'],
    [/полн\w*\s+губ|пухл\w*\s+губ/i, 'lips', 'full'],
    [/широк\w*\s+губ|больш\w*\s+рот/i, 'lips', 'wide'],
    // уши
    [/оттопыр|лопоух|торчащ\w*\s+уш/i, 'ears', 'protruding'],
    [/больш\w*\s+уш|крупн\w*\s+уш/i, 'ears', 'large'],
    [/маленьк\w*\s+уш|мелк\w*\s+уш/i, 'ears', 'small'],
    // причёска
    [/лыс|без волос|облысе/i, 'hairStyle', 'bald'],
    [/залыс|зачёс\w*\s+назад/i, 'hairStyle', 'receding'],
    [/брит\w*\s+голов|очень коротк\w*\s+(волос|стриж)|под ноль/i, 'hairStyle', 'buzz'],
    [/кудряв|вьющ|курчав/i, 'hairStyle', 'curly'],
    [/пучок|собран[а-яё ]{0,16}волос|хвост|коса/i, 'hairStyle', 'bun'],
    [/длинн\w*\s+волос|до плеч|ниже плеч/i, 'hairStyle', 'long'],
    [/коротк\w*\s+(волос|стриж|причёск|прическ)/i, 'hairStyle', 'short'],
    [/средн\w*\s+(длин|волос)/i, 'hairStyle', 'medium'],
    // цвет волос
    [/седой|седая|седин|сед\w*\s+волос/i, 'hairColor', 'gray'],
    [/рыж|рыжеволос/i, 'hairColor', 'red'],
    [/блонд|светловолос|светл\w*\s+волос|белокур/i, 'hairColor', 'blond'],
    [/брюнет|чёрн\w*\s+волос|черн\w*\s+волос|вороног/i, 'hairColor', 'black'],
    [/шатен|тёмно-рус|темно-рус|тёмн\w*\s+волос|темн\w*\s+волос/i, 'hairColor', 'brown'],
    [/рус(ы|ые|ая|ый)|светло-рус/i, 'hairColor', 'lightBrown'],
    // растительность
    [/выбрит|гладко выбр|чисто выбр|бритое лицо/i, 'facialHair', 'none'],
    [/густ\w*\s+бород|больш\w*\s+бород|окладист/i, 'facialHair', 'fullBeard'],
    [/эспаньол|козлин\w*\s+бород|бородк/i, 'facialHair', 'goatee'],
    [/борода|бород\w/i, 'facialHair', 'shortBeard', 'med'],
    [/усат|усик|(^|[\s,.;:])ус(ы|ов|ам|ами)(?=[\s,.;:]|$)/i, 'facialHair', 'mustache'],
    [/щетин|небрит|трёхдневн|трехдневн/i, 'facialHair', 'stubble'],
    // очки
    [/солнцезащ|тёмн\w*\s+очк|чёрн\w*\s+очк|черн\w*\s+очк/i, 'glasses', 'sun'],
    [/прямоуголь\w*\s+очк/i, 'glasses', 'rectangular'],
    [/кругл\w*\s+очк/i, 'glasses', 'rounded'],
    [/очк(и|ах|ов)/i, 'glasses', 'rounded', 'med'],
  ];

  // Особые приметы (множественные).
  const MARK_RULES = [
    [/шрам\w*\s+(на|у)?\s*(прав|лев|на)?\w*\s*щек/i, 'scarCheek'],
    [/шрам\w*\s+(у|над|на)?\s*бров/i, 'scarBrow'],
    [/родин\w*\s+(на|у)?\s*\w*\s*щек/i, 'moleCheek'],
    [/родин\w*\s+(у|возле|около)?\s*\w*\s*губ/i, 'moleLip'],
    [/веснушк/i, 'freckles'],
    [/морщин/i, 'wrinkles'],
    [/шрам/i, 'scarCheek'], // общий шрам -> на щеке
  ];

  // Числовые подсказки на параметры.
  const PARAM_RULES = [
    [/больш\w*\s+нос|крупн\w*\s+нос/i, 'noseSize', 1.18],
    [/больш\w*\s+глаз|крупн\w*\s+глаз/i, 'eyeSize', 1.18],
    [/маленьк\w*\s+глаз|мелк\w*\s+глаз/i, 'eyeSize', 0.85],
    [/широк\w*\s+лиц/i, 'faceWidth', 1.12],
    [/узк\w*\s+лиц|худ\w*\s+лиц/i, 'faceWidth', 0.9],
    [/длинн\w*\s+лиц|вытянут\w*\s+лиц/i, 'faceLength', 1.1],
    [/широк\w*\s+постав\w*\s+глаз|широко расставл\w*\s+глаз/i, 'eyeSpacing', 1.12],
    [/близко постав\w*\s+глаз|близкопостав|близко посаж/i, 'eyeSpacing', 0.88],
    [/длинн\w*\s+нос/i, 'noseLength', 1.15],
    [/коротк\w*\s+нос/i, 'noseLength', 0.85],
    [/высок\w*\s+лоб|больш\w*\s+лоб/i, 'foreheadHeight', 1.14],
    [/низк\w*\s+лоб/i, 'foreheadHeight', 0.88],
  ];

  // В JS `\w` не охватывает кириллицу. Пересобираем все правила, заменяя `\w`
  // на явный буквенно-цифровой класс с кириллицей. Так стемминг вида
  // «густ\w*\s+бров» начинает корректно матчить «густые брови».
  const LETTER = '[а-яёА-ЯЁa-zA-Z0-9]';
  function cyr(re) {
    let s = re.source.replace(/\\w/g, LETTER);
    // Разрешить одно промежуточное слово перед ключевым существительным
    // («тёмные короткие волосы», «густые чёрные брови»): \s+волос -> гибкий зазор.
    s = s.replace(/\\s\+(волос|лиц|глаз|бров|нос|губ|подбород|уш)/g, '[а-яё ]{1,16}$1');
    return new RegExp(s, re.flags);
  }
  // 4-й элемент правила — уверенность: 'high' (явно назван), 'med' (оценка/допущение).
  // По умолчанию категориальные правила = high, числовые (величины) = med.
  const RULES_C = RULES.map((r) => [cyr(r[0]), r[1], r[2], r[3] || 'high']);
  const MARK_RULES_C = MARK_RULES.map((r) => [cyr(r[0]), r[1]]);
  const PARAM_RULES_C = PARAM_RULES.map((r) => [cyr(r[0]), r[1], r[2], r[3] || 'med']);

  // Отрицание перед признаком: «без бороды», «без очков», «не было веснушек».
  // Смотрим короткое окно слева от совпадения. «без/безо» + пробел, либо «не»
  // (как отдельное слово) + до одного промежуточного слова. `\bне` не цепляет
  // слова вида «неровный» (после требуется пробел).
  const NEG_BEFORE = /(без|безо)\s+$|\bне\s+(\S+\s+)?$/i;
  function negatedAt(text, idx) {
    if (idx == null || idx < 0) return false;
    return NEG_BEFORE.test(text.slice(Math.max(0, idx - 14), idx));
  }

  function extract(text) {
    const t = (text || '').toLowerCase();
    const values = {};
    const params = {};
    const evidence = [];
    const seen = {};

    RULES_C.forEach((r) => {
      const [re, key, val, conf] = r;
      if (seen[key]) return;
      const mt = t.match(re);
      if (mt) {
        if (negatedAt(t, mt.index)) {
          // «без бороды/очков» — это явное отсутствие, а не пропуск признака.
          if (key === 'glasses' || key === 'facialHair') {
            values[key] = 'none'; seen[key] = true;
            evidence.push({ trait: key, value: 'none', match: 'без ' + mt[0].trim(), conf: 'high' });
          }
          return; // для остальных признаков отрицание просто не выставляет значение
        }
        values[key] = val;
        seen[key] = true;
        evidence.push({ trait: key, value: val, match: mt[0].trim(), conf: conf });
      }
    });

    const marks = [];
    MARK_RULES_C.forEach((r) => {
      const [re, mk] = r;
      if (marks.indexOf(mk) !== -1) return;
      const mt = t.match(re);
      if (mt && !negatedAt(t, mt.index)) {
        marks.push(mk); evidence.push({ trait: 'mark', value: mk, match: mt[0].trim(), conf: 'high' });
      }
    });

    PARAM_RULES_C.forEach((r) => {
      const [re, key, val, conf] = r;
      if (key in params) return;
      const mt = t.match(re);
      if (mt && !negatedAt(t, mt.index)) {
        params[key] = val; evidence.push({ trait: key, value: val, match: mt[0].trim(), conf: conf });
      }
    });

    return { values: values, params: params, marks: marks, evidence: evidence };
  }

  FC.extract = { extract: extract };
})(window.FC = window.FC || {});
