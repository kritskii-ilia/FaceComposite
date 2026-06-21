/*
 * traits.js — нормализованная таксономия признаков внешности и модель профиля.
 *
 * Это единственный источник правды о том, какими признаками оперирует система.
 * И движок извлечения из текста (extract.js), и движок отрисовки (render.js),
 * и построение UI (ui.js) читают именно отсюда. Добавление нового признака —
 * это правка только этого файла + генератора в render.js.
 *
 * Профиль (TraitProfile) состоит из двух частей:
 *   values  — категориальные выборы (форма лица, тип носа, цвет волос ...)
 *   params  — непрерывные числовые корректировки (ширина лица, размер глаз ...)
 *             каждый параметр это множитель/смещение, 1.0 = норма.
 *
 * Такое разделение заложено осознанно: на этапе 2 (распознавание речи,
 * умная интерпретация) появится третий слой — confidence/evidence на каждый
 * признак, и он встанет рядом, не ломая values/params.
 */
(function (FC) {
  'use strict';

  // Категориальные признаки. type:'select' — одиночный выбор из options.
  const SELECTS = [
    {
      key: 'gender', label: 'Пол', group: 'Основное', default: 'male',
      options: [
        { value: 'male', label: 'Мужской' },
        { value: 'female', label: 'Женский' },
      ],
    },
    {
      key: 'ageBand', label: 'Возраст', group: 'Основное', default: 'adult',
      options: [
        { value: 'child', label: 'Ребёнок' },
        { value: 'teen', label: 'Подросток' },
        { value: 'young', label: 'Молодой (18–30)' },
        { value: 'adult', label: 'Взрослый (30–45)' },
        { value: 'middle', label: 'Средний (45–60)' },
        { value: 'senior', label: 'Пожилой (60+)' },
      ],
    },
    {
      key: 'skinTone', label: 'Тон кожи', group: 'Основное', default: 'light',
      options: [
        { value: 'pale', label: 'Очень светлый', color: '#f5dcc6' },
        { value: 'light', label: 'Светлый', color: '#eecaa8' },
        { value: 'medium', label: 'Средний', color: '#e0b088' },
        { value: 'tan', label: 'Смуглый', color: '#c89464' },
        { value: 'brown', label: 'Тёмный', color: '#9c6b43' },
        { value: 'dark', label: 'Очень тёмный', color: '#6e4626' },
      ],
    },
    {
      key: 'faceShape', label: 'Форма лица', group: 'Лицо', default: 'oval',
      options: [
        { value: 'oval', label: 'Овальная' },
        { value: 'round', label: 'Круглая' },
        { value: 'square', label: 'Квадратная' },
        { value: 'rectangular', label: 'Прямоугольная' },
        { value: 'heart', label: 'Треугольная (сердце)' },
        { value: 'diamond', label: 'Ромбовидная' },
      ],
    },
    {
      key: 'chinLine', label: 'Подбородок', group: 'Лицо', default: 'round',
      options: [
        { value: 'round', label: 'Округлый' },
        { value: 'soft', label: 'Мягкий' },
        { value: 'square', label: 'Квадратный' },
        { value: 'pointed', label: 'Заострённый' },
        { value: 'double', label: 'С двойным' },
      ],
    },
    {
      key: 'eyes', label: 'Форма глаз', group: 'Глаза и брови', default: 'almond',
      options: [
        { value: 'almond', label: 'Миндалевидные' },
        { value: 'round', label: 'Круглые' },
        { value: 'narrow', label: 'Узкие' },
        { value: 'hooded', label: 'С нависшим веком' },
        { value: 'downturned', label: 'Опущенные' },
        { value: 'upturned', label: 'Приподнятые' },
      ],
    },
    {
      key: 'eyeColor', label: 'Цвет глаз', group: 'Глаза и брови', default: 'brown',
      options: [
        { value: 'brown', label: 'Карие', color: '#5b3a21' },
        { value: 'hazel', label: 'Ореховые', color: '#7a5a2e' },
        { value: 'green', label: 'Зелёные', color: '#3f6b3f' },
        { value: 'blue', label: 'Голубые', color: '#4a6f8a' },
        { value: 'gray', label: 'Серые', color: '#6b7177' },
      ],
    },
    {
      key: 'eyebrows', label: 'Брови', group: 'Глаза и брови', default: 'medium',
      options: [
        { value: 'thin', label: 'Тонкие' },
        { value: 'medium', label: 'Средние' },
        { value: 'thick', label: 'Густые' },
        { value: 'arched', label: 'Дугообразные' },
        { value: 'straight', label: 'Прямые' },
      ],
    },
    {
      key: 'nose', label: 'Нос', group: 'Нос и губы', default: 'straight',
      options: [
        { value: 'straight', label: 'Прямой' },
        { value: 'wide', label: 'Широкий' },
        { value: 'narrow', label: 'Узкий' },
        { value: 'hooked', label: 'С горбинкой' },
        { value: 'upturned', label: 'Курносый' },
        { value: 'snub', label: 'Картошкой' },
      ],
    },
    {
      key: 'lips', label: 'Губы', group: 'Нос и губы', default: 'medium',
      options: [
        { value: 'thin', label: 'Тонкие' },
        { value: 'medium', label: 'Средние' },
        { value: 'full', label: 'Полные' },
        { value: 'wide', label: 'Широкие' },
      ],
    },
    {
      key: 'ears', label: 'Уши', group: 'Лицо', default: 'medium',
      options: [
        { value: 'small', label: 'Маленькие' },
        { value: 'medium', label: 'Средние' },
        { value: 'large', label: 'Крупные' },
        { value: 'protruding', label: 'Оттопыренные' },
      ],
    },
    {
      key: 'hairStyle', label: 'Причёска', group: 'Волосы', default: 'short',
      options: [
        { value: 'bald', label: 'Лысина' },
        { value: 'buzz', label: 'Очень короткие' },
        { value: 'short', label: 'Короткие' },
        { value: 'medium', label: 'Средние' },
        { value: 'long', label: 'Длинные' },
        { value: 'curly', label: 'Кудрявые' },
        { value: 'bun', label: 'Собранные / пучок' },
        { value: 'receding', label: 'С залысинами' },
      ],
    },
    {
      key: 'hairColor', label: 'Цвет волос', group: 'Волосы', default: 'brown',
      options: [
        { value: 'black', label: 'Чёрные', color: '#2b2724' },
        { value: 'brown', label: 'Тёмно-русые', color: '#5a4233' },
        { value: 'lightBrown', label: 'Светло-русые', color: '#8a6a48' },
        { value: 'blond', label: 'Блондин', color: '#c8a25e' },
        { value: 'red', label: 'Рыжие', color: '#a4502a' },
        { value: 'gray', label: 'Седые', color: '#9a9690' },
      ],
    },
    {
      key: 'facialHair', label: 'Растительность', group: 'Волосы', default: 'none',
      options: [
        { value: 'none', label: 'Нет' },
        { value: 'stubble', label: 'Щетина' },
        { value: 'mustache', label: 'Усы' },
        { value: 'goatee', label: 'Эспаньолка' },
        { value: 'shortBeard', label: 'Короткая борода' },
        { value: 'fullBeard', label: 'Густая борода' },
      ],
    },
    {
      key: 'glasses', label: 'Очки', group: 'Аксессуары', default: 'none',
      options: [
        { value: 'none', label: 'Нет' },
        { value: 'rounded', label: 'Круглые' },
        { value: 'rectangular', label: 'Прямоугольные' },
        { value: 'sun', label: 'Солнцезащитные' },
      ],
    },
  ];

  // Непрерывные корректировки. value=default означает «как заложено формой».
  const SLIDERS = [
    { key: 'faceWidth', label: 'Ширина лица', group: 'Геометрия лица', min: 0.82, max: 1.18, step: 0.01, default: 1 },
    { key: 'faceLength', label: 'Длина лица', group: 'Геометрия лица', min: 0.85, max: 1.15, step: 0.01, default: 1 },
    { key: 'jawWidth', label: 'Ширина челюсти', group: 'Геометрия лица', min: 0.8, max: 1.2, step: 0.01, default: 1 },
    { key: 'foreheadHeight', label: 'Высота лба', group: 'Геометрия лица', min: 0.8, max: 1.2, step: 0.01, default: 1 },
    { key: 'eyeSize', label: 'Размер глаз', group: 'Расположение черт', min: 0.8, max: 1.25, step: 0.01, default: 1 },
    { key: 'eyeSpacing', label: 'Расстояние между глазами', group: 'Расположение черт', min: 0.85, max: 1.15, step: 0.01, default: 1 },
    { key: 'eyeHeight', label: 'Высота линии глаз', group: 'Расположение черт', min: -18, max: 18, step: 1, default: 0 },
    { key: 'noseSize', label: 'Размер носа', group: 'Расположение черт', min: 0.8, max: 1.25, step: 0.01, default: 1 },
    { key: 'noseLength', label: 'Длина носа', group: 'Расположение черт', min: 0.85, max: 1.2, step: 0.01, default: 1 },
    { key: 'mouthSize', label: 'Размер рта', group: 'Расположение черт', min: 0.8, max: 1.25, step: 0.01, default: 1 },
    { key: 'mouthHeight', label: 'Высота линии рта', group: 'Расположение черт', min: -14, max: 14, step: 1, default: 0 },
    { key: 'browHeight', label: 'Высота бровей', group: 'Расположение черт', min: -10, max: 10, step: 1, default: 0 },
  ];

  // Особые приметы — список включаемых меток с типом и стороной.
  const MARKS = [
    { value: 'scarCheek', label: 'Шрам на щеке' },
    { value: 'scarBrow', label: 'Шрам у брови' },
    { value: 'moleCheek', label: 'Родинка на щеке' },
    { value: 'moleLip', label: 'Родинка у губы' },
    { value: 'freckles', label: 'Веснушки' },
    { value: 'wrinkles', label: 'Морщины' },
  ];

  function defaultProfile() {
    const values = {};
    SELECTS.forEach((s) => { values[s.key] = s.default; });
    const params = {};
    SLIDERS.forEach((s) => { params[s.key] = s.default; });
    return { values: values, params: params, marks: [] };
  }

  // Удобный доступ к определению признака и подписи значения.
  function selectDef(key) { return SELECTS.find((s) => s.key === key); }
  function optionColor(key, value) {
    const d = selectDef(key);
    const o = d && d.options.find((x) => x.value === value);
    return o ? o.color : null;
  }
  function optionLabel(key, value) {
    const d = selectDef(key);
    const o = d && d.options.find((x) => x.value === value);
    return o ? o.label : value;
  }

  FC.traits = {
    SELECTS: SELECTS,
    SLIDERS: SLIDERS,
    MARKS: MARKS,
    defaultProfile: defaultProfile,
    selectDef: selectDef,
    optionColor: optionColor,
    optionLabel: optionLabel,
  };
})(window.FC = window.FC || {});
