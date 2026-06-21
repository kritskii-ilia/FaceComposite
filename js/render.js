/*
 * render.js — параметрический движок сборки лица.
 *
 * На вход — TraitProfile (values + params + marks), на выходе — строка <svg>.
 * Лицо НЕ собирается из готовых картинок: каждая черта рисуется кодом из
 * опорных точек, вычисленных от геометрии головы. Благодаря этому любую черту
 * можно плавно крутить ползунками (требование брифа «ручная корректировка»),
 * а стиль всех частей гарантированно единый.
 *
 * Слои рисуются в осознанном порядке (задние волосы → уши → голова → черты →
 * борода → очки → передние волосы → приметы), чтобы перекрытия были корректны.
 */
(function (FC) {
  'use strict';

  const VIEW_W = 400;
  const VIEW_H = 560;
  const CX = 200;
  const TOP_Y = 78;          // макушка
  const BASE_FACE_H = 384;   // базовая высота лица до подбородка
  const BASE_HALF = 120;     // базовая полуширина

  const STROKE = '#43362e';
  const STROKE_W = 3;

  // Относительные полуширины головы на 6 уровнях сверху вниз
  // (лоб, висок, бровь/глаз, скула, щека/челюсть-верх, челюсть-низ).
  const SHAPE = {
    oval:        [0.80, 0.93, 0.99, 1.00, 0.88, 0.66],
    round:       [0.90, 1.00, 1.03, 1.03, 0.97, 0.80],
    square:      [0.90, 0.98, 1.00, 1.00, 0.99, 0.92],
    rectangular: [0.84, 0.92, 0.95, 0.95, 0.93, 0.84],
    heart:       [0.92, 1.00, 0.99, 0.92, 0.74, 0.52],
    diamond:     [0.64, 0.84, 0.97, 1.05, 0.86, 0.60],
  };
  const LEVEL_T = [0.13, 0.28, 0.45, 0.58, 0.74, 0.88];

  /* ---------- маленькие хелперы ---------- */
  function n(v) { return Math.round(v * 100) / 100; }

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (x) => ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2);
    return '#' + c(r) + c(g) + c(b);
  }
  function shade(hex, f) { // f<1 темнее, f>1 светлее
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * f, g * f, b * f);
  }

  // Замкнутый гладкий контур через точки (Catmull-Rom -> кубические Безье).
  function closedSpline(pts) {
    const N = pts.length;
    let d = 'M ' + n(pts[0][0]) + ' ' + n(pts[0][1]) + ' ';
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i - 1 + N) % N];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % N];
      const p3 = pts[(i + 2) % N];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C ' + n(c1x) + ' ' + n(c1y) + ' ' + n(c2x) + ' ' + n(c2y) + ' ' + n(p2[0]) + ' ' + n(p2[1]) + ' ';
    }
    return d + 'Z';
  }

  /* ---------- геометрия головы ---------- */
  function metrics(profile) {
    const p = profile.params;
    const gender = profile.values.gender;
    const age = profile.values.ageBand;

    // Возраст: дети — короче лицо и крупнее черепная часть (черты ниже и крупнее
    // глаза); пожилые — чуть длиннее. Пол: женское лицо уже и с мягкой челюстью.
    const ageLenK = age === 'child' ? 0.9 : age === 'teen' ? 0.96 : age === 'senior' ? 1.03 : 1;
    const ageEyeK = age === 'child' ? 1.22 : age === 'teen' ? 1.08 : age === 'senior' ? 0.95 : 1;
    const ageLowerK = age === 'child' ? 0.56 : 0.5; // доля высоты до линии глаз (больше лоб у детей)
    const genderWidthK = gender === 'female' ? 0.955 : 1.0;
    const genderJawK = gender === 'female' ? 0.9 : 1.05;

    const faceH = BASE_FACE_H * p.faceLength * ageLenK;
    const half = BASE_HALF * p.faceWidth * genderWidthK;
    const chinY = TOP_Y + faceH;
    const w = SHAPE[profile.values.faceShape] || SHAPE.oval;
    const jaw = p.jawWidth;
    const chinKind = profile.values.chinLine;

    // полуширины по уровням с учётом ширины челюсти, пола и подбородка
    const halves = w.map((mult, i) => {
      let m = mult;
      if (i >= 4) m *= jaw * genderJawK;  // челюсть
      if (i === 5) {
        if (chinKind === 'square') m *= 1.14;
        if (chinKind === 'pointed') m *= 0.72;
        if (chinKind === 'soft') m *= 0.92;
      }
      return half * m;
    });

    const featureShift = (p.foreheadHeight - 1) * 46;
    const eyeLineY = TOP_Y + faceH * ageLowerK + featureShift + p.eyeHeight;
    const browLineY = eyeLineY - 30 + p.browHeight;
    const eyeDX = 52 * p.eyeSpacing * genderWidthK;
    const noseTopY = eyeLineY + 16;
    const noseBottomY = noseTopY + 66 * p.noseLength * (age === 'child' ? 0.82 : 1);
    const mouthY = noseBottomY + 44 + p.mouthHeight;
    const earY = eyeLineY + 12;

    return {
      faceH, half, chinY, halves, eyeLineY, browLineY, eyeDX,
      noseTopY, noseBottomY, mouthY, earY, chinKind,
      gender, age, ageEyeK,
      // ширина головы на уровне ушей (уровень скулы, индекс 3)
      earHalf: halves[3],
    };
  }

  function headPath(m) {
    const pts = [];
    pts.push([CX, TOP_Y]); // макушка-апекс
    for (let i = 0; i < LEVEL_T.length; i++) {
      pts.push([CX + m.halves[i], TOP_Y + LEVEL_T[i] * m.faceH]);
    }
    pts.push([CX, m.chinY]); // подбородок-апекс
    for (let i = LEVEL_T.length - 1; i >= 0; i--) {
      pts.push([CX - m.halves[i], TOP_Y + LEVEL_T[i] * m.faceH]);
    }
    return closedSpline(pts);
  }

  /* ---------- черты лица ---------- */
  function eye(ex, ey, ew, eh, tiltOuter, side, eyeColorHex, id) {
    const outerX = ex + side * ew, innerX = ex - side * ew;
    const outerY = ey + tiltOuter, innerY = ey - tiltOuter * 0.3;
    const cy = (outerY + innerY) / 2;
    const topMidY = Math.min(outerY, innerY) - eh;
    const botMidY = Math.max(outerY, innerY) + eh;
    const upperArc = 'M ' + n(innerX) + ' ' + n(innerY) + ' Q ' + n(ex) + ' ' + n(topMidY) + ' ' + n(outerX) + ' ' + n(outerY);
    const lowerArc = 'M ' + n(innerX) + ' ' + n(innerY) + ' Q ' + n(ex) + ' ' + n(botMidY) + ' ' + n(outerX) + ' ' + n(outerY);
    const lens = 'M ' + n(innerX) + ' ' + n(innerY) +
      ' Q ' + n(ex) + ' ' + n(topMidY) + ' ' + n(outerX) + ' ' + n(outerY) +
      ' Q ' + n(ex) + ' ' + n(botMidY) + ' ' + n(innerX) + ' ' + n(innerY) + ' Z';
    const irisR = eh * 1.05;
    const irisLight = shade(eyeColorHex, 1.5);
    const irisDark = shade(eyeColorHex, 0.55);
    return '' +
      '<radialGradient id="iris' + id + '" cx="50%" cy="40%" r="62%">' +
        '<stop offset="0" stop-color="' + irisLight + '"/>' +
        '<stop offset="0.6" stop-color="' + eyeColorHex + '"/>' +
        '<stop offset="1" stop-color="' + irisDark + '"/>' +
      '</radialGradient>' +
      '<clipPath id="clip' + id + '"><path d="' + lens + '"/></clipPath>' +
      '<path d="' + lens + '" fill="#f7f4ef"/>' +
      '<g clip-path="url(#clip' + id + ')">' +
        // лёгкая тень склеры от верхнего века
        '<path d="' + upperArc + ' L ' + n(outerX) + ' ' + n(outerY - eh) + ' L ' + n(innerX) + ' ' + n(innerY - eh) + ' Z" fill="#000000" opacity="0.10"/>' +
        '<circle cx="' + n(ex) + '" cy="' + n(cy) + '" r="' + n(irisR) + '" fill="url(#iris' + id + ')"/>' +
        // лимбальное кольцо — тёмный ободок радужки (даёт «живой» взгляд)
        '<circle cx="' + n(ex) + '" cy="' + n(cy) + '" r="' + n(irisR) + '" fill="none" stroke="' + irisDark + '" stroke-width="1.4" opacity="0.75"/>' +
        '<circle cx="' + n(ex) + '" cy="' + n(cy) + '" r="' + n(irisR * 0.42) + '" fill="#130f0f"/>' +
        // два блика: крупный сверху-снаружи и слабый снизу
        '<circle cx="' + n(ex + side * irisR * 0.32) + '" cy="' + n(cy - irisR * 0.34) + '" r="' + n(irisR * 0.18) + '" fill="#ffffff" opacity="0.92"/>' +
        '<circle cx="' + n(ex - side * irisR * 0.2) + '" cy="' + n(cy + irisR * 0.32) + '" r="' + n(irisR * 0.08) + '" fill="#ffffff" opacity="0.5"/>' +
      '</g>' +
      // верхняя линия ресниц (толще/темнее) и нижнее веко (тоньше)
      '<path d="' + upperArc + '" fill="none" stroke="' + STROKE + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="' + lowerArc + '" fill="none" stroke="' + STROKE + '" stroke-width="1.3" opacity="0.5"/>' +
      // слёзник у внутреннего угла
      '<circle cx="' + n(innerX + side * 2.5) + '" cy="' + n(innerY + 1) + '" r="2.3" fill="#c9897d" opacity="0.7"/>';
  }

  function eyesGroup(m, profile) {
    const p = profile.params;
    const type = profile.values.eyes;
    const eyeColor = FC.traits.optionColor('eyeColor', profile.values.eyeColor) || '#5b3a21';
    const k = p.eyeSize * m.ageEyeK;
    let ew = 25 * k, eh = 13 * k;
    let tilt = 0;
    if (type === 'round') { ew = 21 * k; eh = 17 * k; }
    if (type === 'narrow') { eh = 8 * k; }
    if (type === 'hooded') { eh = 12 * k; }
    if (type === 'downturned') { tilt = 6; }
    if (type === 'upturned') { tilt = -6; }
    const ly = m.eyeLineY;
    const female = m.gender === 'female';
    let s = '';
    s += eye(CX + m.eyeDX, ly, ew, eh, type === 'upturned' ? -tilt : tilt, +1, eyeColor, 'R');
    s += eye(CX - m.eyeDX, ly, ew, eh, type === 'upturned' ? -tilt : tilt, -1, eyeColor, 'L');

    [+1, -1].forEach((side) => {
      const cxe = CX + side * m.eyeDX;
      // складка верхнего века (у всех) / нависшее веко (тип hooded — выраженнее)
      const lift = type === 'hooded' ? 9 : 5;
      s += '<path d="M ' + n(cxe - ew * 0.85) + ' ' + n(ly - eh - 2) +
        ' Q ' + n(cxe) + ' ' + n(ly - eh - lift) + ' ' + n(cxe + ew * 0.9) + ' ' + n(ly - eh - 1) +
        '" fill="none" stroke="' + STROKE + '" stroke-width="' + (type === 'hooded' ? 2 : 1.4) + '" opacity="' + (type === 'hooded' ? 0.6 : 0.4) + '"/>';
      // ресницы для женских лиц — короткие штрихи у внешнего угла
      if (female) {
        for (let i = 0; i < 3; i++) {
          const t = i / 2;
          const lx = cxe + side * ew * (0.45 + t * 0.5);
          const ly2 = ly - eh * (1 - t * 0.5);
          s += '<path d="M ' + n(lx) + ' ' + n(ly2) + ' l ' + n(side * 3) + ' ' + n(-4 - t * 2) +
            '" stroke="' + STROKE + '" stroke-width="1.4"/>';
        }
      }
    });
    return s;
  }

  function browsGroup(m, profile) {
    const type = profile.values.eyebrows;
    let thick = 5, arch = 8;
    if (type === 'thin') thick = 3;
    if (type === 'thick') thick = 9;
    if (type === 'straight') arch = 1;
    if (type === 'arched') arch = 14;
    const by = m.browLineY;
    const bw = 30;
    let s = '';
    [+1, -1].forEach((side) => {
      const c = CX + side * m.eyeDX;
      const inner = c - side * bw, outer = c + side * bw;
      s += '<path d="M ' + n(inner) + ' ' + n(by + 3) +
        ' Q ' + n(c) + ' ' + n(by - arch) + ' ' + n(outer) + ' ' + n(by + 1) +
        '" fill="none" stroke="' + STROKE + '" stroke-width="' + thick + '" stroke-linecap="round"/>';
    });
    return s;
  }

  function noseGroup(m, profile) {
    const p = profile.params;
    const type = profile.values.nose;
    const topY = m.noseTopY, botY = m.noseBottomY;
    let baseW = 17 * p.noseSize;
    if (type === 'wide' || type === 'snub') baseW = 24 * p.noseSize;
    if (type === 'narrow') baseW = 12 * p.noseSize;
    const bridgeX = 6;
    let bridge = '';
    // боковые крылья носа: в анфас спинка почти не обведена — лёгкий намёк снизу,
    // основной объём даёт мягкая тень (см. shading). Видимая часть начинается
    // от середины и усиливается книзу, поэтому переход к крыльям читается, а
    // «жирной» линии вдоль всего носа нет.
    const ctrlX = type === 'hooked' ? bridgeX + 7 : bridgeX;
    const midY = (topY + botY) / 2;
    [+1, -1].forEach((side) => {
      bridge += '<path d="M ' + n(CX + side * (bridgeX + 1)) + ' ' + n(midY) +
        ' C ' + n(CX + side * ctrlX) + ' ' + n(midY + (botY - midY) * 0.4) + ' ' + n(CX + side * baseW * 0.7) + ' ' + n(botY - 12) + ' ' + n(CX + side * baseW) + ' ' + n(botY) +
        '" fill="none" stroke="' + STROKE + '" stroke-width="1.8" opacity="0.32"/>';
    });
    // для носа с горбинкой — короткий штрих на спинке сверху (профильная примета)
    if (type === 'hooked') {
      bridge += '<path d="M ' + n(CX - 4) + ' ' + n(topY + 4) + ' Q ' + n(CX + 6) + ' ' + n(midY - 6) + ' ' + n(CX - 2) + ' ' + n(midY) +
        '" fill="none" stroke="' + STROKE + '" stroke-width="1.6" opacity="0.3"/>';
    }
    // основание/ноздри
    let tipY = botY;
    if (type === 'upturned') tipY = botY - 6;
    const base = '<path d="M ' + n(CX - baseW) + ' ' + n(botY) +
      ' Q ' + n(CX - baseW) + ' ' + n(tipY + 9) + ' ' + n(CX) + ' ' + n(tipY + 9) +
      ' Q ' + n(CX + baseW) + ' ' + n(tipY + 9) + ' ' + n(CX + baseW) + ' ' + n(botY) +
      '" fill="none" stroke="' + STROKE + '" stroke-width="2.6"/>';
    const nostrilR = baseW * 0.16;
    const nostrils =
      '<circle cx="' + n(CX - baseW * 0.66) + '" cy="' + n(botY + 1) + '" r="' + n(nostrilR) + '" fill="' + STROKE + '" opacity="0.7"/>' +
      '<circle cx="' + n(CX + baseW * 0.66) + '" cy="' + n(botY + 1) + '" r="' + n(nostrilR) + '" fill="' + STROKE + '" opacity="0.7"/>';
    return bridge + base + nostrils;
  }

  function mouthGroup(m, profile) {
    const p = profile.params;
    const type = profile.values.lips;
    let mw = 42 * p.mouthSize, lipH = 9;
    if (type === 'thin') lipH = 6;
    if (type === 'full') lipH = 14;
    if (type === 'wide') { mw = 52 * p.mouthSize; lipH = 9; }
    const y = m.mouthY;
    const half = mw / 2;
    const base = m.gender === 'female' ? '#c0746a' : '#b07064';
    const upperFill = shade(base, 0.82);   // верхняя губа в тени — темнее
    const lowerFill = shade(base, 1.08);   // нижняя ловит свет — светлее
    const edge = shade(base, 0.6);
    // верхняя губа с «луком купидона», вниз до линии рта
    const upper = 'M ' + n(CX - half) + ' ' + n(y) +
      ' Q ' + n(CX - half * 0.5) + ' ' + n(y - lipH) + ' ' + n(CX) + ' ' + n(y - lipH * 0.35) +
      ' Q ' + n(CX + half * 0.5) + ' ' + n(y - lipH) + ' ' + n(CX + half) + ' ' + n(y) +
      ' Q ' + n(CX + half * 0.5) + ' ' + n(y + 1.5) + ' ' + n(CX) + ' ' + n(y + 2) +
      ' Q ' + n(CX - half * 0.5) + ' ' + n(y + 1.5) + ' ' + n(CX - half) + ' ' + n(y) + ' Z';
    // нижняя губа — полная, объёмная
    const lower = 'M ' + n(CX - half) + ' ' + n(y) +
      ' Q ' + n(CX) + ' ' + n(y + 2) + ' ' + n(CX + half) + ' ' + n(y) +
      ' Q ' + n(CX + half * 0.42) + ' ' + n(y + lipH * 1.7) + ' ' + n(CX) + ' ' + n(y + lipH * 1.8) +
      ' Q ' + n(CX - half * 0.42) + ' ' + n(y + lipH * 1.7) + ' ' + n(CX - half) + ' ' + n(y) + ' Z';
    // линия смыкания губ — самая тёмная
    const line = '<path d="M ' + n(CX - half) + ' ' + n(y) + ' Q ' + n(CX) + ' ' + n(y + 2) + ' ' + n(CX + half) + ' ' + n(y) +
      '" fill="none" stroke="' + shade(base, 0.42) + '" stroke-width="2.2" stroke-linecap="round"/>';
    // блик на нижней губе
    const hi = softEllipse(CX, y + lipH * 0.95, half * 0.5, lipH * 0.42, 0, 0.6, 'url(#hi)');
    // желобок над губой (фильтрум) — две мягкие бороздки
    const philtrum =
      '<path d="M ' + n(CX - 3) + ' ' + n(y - lipH * 1.15) + ' L ' + n(CX - 3) + ' ' + n(y - lipH * 0.35) + '" stroke="' + shade(base, 0.7) + '" stroke-width="1.2" opacity="0.3" fill="none"/>' +
      '<path d="M ' + n(CX + 3) + ' ' + n(y - lipH * 1.15) + ' L ' + n(CX + 3) + ' ' + n(y - lipH * 0.35) + '" stroke="' + shade(base, 0.7) + '" stroke-width="1.2" opacity="0.3" fill="none"/>';
    return philtrum +
      '<path d="' + lower + '" fill="' + lowerFill + '" stroke="' + edge + '" stroke-width="1.4"/>' +
      '<path d="' + upper + '" fill="' + upperFill + '" stroke="' + edge + '" stroke-width="1.4"/>' +
      hi + line;
  }

  function earsGroup(m, profile, skin, skinLine) {
    const type = profile.values.ears;
    let er = 22, off = 0, rot = 0;
    if (type === 'small') er = 17;
    if (type === 'large') er = 27;
    if (type === 'protruding') { off = 7; rot = 14; }
    const y = m.earY;
    const x = m.earHalf;
    let s = '';
    [+1, -1].forEach((side) => {
      const ex = CX + side * (x + off - 4);
      s += '<g transform="translate(' + n(ex) + ' ' + n(y) + ') rotate(' + (side * rot) + ')">' +
        '<path d="M 0 ' + n(-er * 0.7) + ' C ' + n(side * er) + ' ' + n(-er * 0.8) + ' ' + n(side * er * 1.05) + ' ' + n(er * 0.6) + ' 0 ' + n(er) +
        ' C ' + n(side * -er * 0.1) + ' ' + n(er * 0.9) + ' ' + n(side * -er * 0.1) + ' ' + n(-er * 0.5) + ' 0 ' + n(-er * 0.7) + ' Z" ' +
        'fill="' + skin + '" stroke="' + skinLine + '" stroke-width="' + STROKE_W + '"/>' +
        '<path d="M ' + n(side * er * 0.25) + ' ' + n(-er * 0.3) + ' C ' + n(side * er * 0.6) + ' 0 ' + n(side * er * 0.5) + ' ' + n(er * 0.45) + ' ' + n(side * er * 0.12) + ' ' + n(er * 0.55) +
        '" fill="none" stroke="' + skinLine + '" stroke-width="2" opacity="0.7"/>' +
        '</g>';
    });
    return s;
  }

  /* ---------- волосы ---------- */
  function hairColor(profile) { return FC.traits.optionColor('hairColor', profile.values.hairColor) || '#5a4233'; }

  function hairBack(m, profile) {
    const style = profile.values.hairStyle;
    if (style === 'bald' || style === 'buzz' || style === 'short' || style === 'receding') return '';
    const col = hairColor(profile);
    const downY = style === 'long' ? m.chinY + 40 : (style === 'bun' ? m.eyeLineY + 30 : m.chinY - 30);
    const wx = m.half * 1.12;
    return '<path d="M ' + n(CX - wx) + ' ' + n(m.browLineY - 10) +
      ' C ' + n(CX - wx * 1.1) + ' ' + n(downY) + ' ' + n(CX - wx * 0.5) + ' ' + n(downY) + ' ' + n(CX) + ' ' + n(downY) +
      ' C ' + n(CX + wx * 0.5) + ' ' + n(downY) + ' ' + n(CX + wx * 1.1) + ' ' + n(downY) + ' ' + n(CX + wx) + ' ' + n(m.browLineY - 10) +
      ' Z" fill="' + shade(col, 0.85) + '"/>';
  }

  function hairFront(m, profile) {
    const style = profile.values.hairStyle;
    if (style === 'bald') return '';
    const col = hairColor(profile);
    const line = shade(col, 0.7);
    const topArc = TOP_Y - 14;
    const wx = m.halves[1] * 1.04; // на уровне виска
    const lx = CX - wx, rx = CX + wx;
    let hairlineY = m.browLineY - m.faceH * 0.085;

    if (style === 'buzz' || style === 'short' || style === 'receding') {
      // плотная «шапка» по черепу
      let midDip = hairlineY - 6;
      let path;
      if (style === 'receding') {
        // M-образная линия роста волос
        path = 'M ' + n(lx) + ' ' + n(hairlineY + 6) +
          ' Q ' + n(CX - wx * 0.55) + ' ' + n(hairlineY - 16) + ' ' + n(CX - wx * 0.28) + ' ' + n(hairlineY + 8) +
          ' Q ' + n(CX) + ' ' + n(hairlineY + 22) + ' ' + n(CX + wx * 0.28) + ' ' + n(hairlineY + 8) +
          ' Q ' + n(CX + wx * 0.55) + ' ' + n(hairlineY - 16) + ' ' + n(rx) + ' ' + n(hairlineY + 6);
      } else {
        path = 'M ' + n(lx) + ' ' + n(hairlineY) +
          ' Q ' + n(CX) + ' ' + n(midDip) + ' ' + n(rx) + ' ' + n(hairlineY);
      }
      path += ' C ' + n(rx + 14) + ' ' + n(TOP_Y + 30) + ' ' + n(CX + 70) + ' ' + n(topArc) + ' ' + n(CX) + ' ' + n(topArc) +
        ' C ' + n(CX - 70) + ' ' + n(topArc) + ' ' + n(lx - 14) + ' ' + n(TOP_Y + 30) + ' ' + n(lx) + ' ' + n(hairlineY) + ' Z';
      const fill = style === 'buzz' ? shade(col, 0.9) : col;
      return '<path d="' + path + '" fill="' + fill + '" stroke="' + line + '" stroke-width="1.5"/>';
    }

    // средние/длинные/кудрявые/пучок — объёмная масса сверху и по бокам
    let sideY = style === 'long' ? m.chinY - 10 : m.eyeLineY + 20;
    const bumpy = style === 'curly';
    const topY2 = topArc - (style === 'long' || style === 'medium' ? 6 : 0);
    let edge = 'M ' + n(lx - 8) + ' ' + n(sideY);
    edge += ' C ' + n(lx - 22) + ' ' + n(m.browLineY) + ' ' + n(lx - 22) + ' ' + n(TOP_Y + 20) + ' ' + n(CX) + ' ' + n(topY2 - (bumpy ? 6 : 0));
    edge += ' C ' + n(rx + 22) + ' ' + n(TOP_Y + 20) + ' ' + n(rx + 22) + ' ' + n(m.browLineY) + ' ' + n(rx + 8) + ' ' + n(sideY);
    // нижняя линия чёлки — аккуратная линия роста с лёгким боковым пробором
    edge += ' L ' + n(rx - 2) + ' ' + n(sideY) +
      ' C ' + n(CX + wx * 0.45) + ' ' + n(hairlineY + 8) + ' ' + n(CX + wx * 0.16) + ' ' + n(hairlineY + 3) + ' ' + n(CX + wx * 0.04) + ' ' + n(hairlineY + 6) +
      ' C ' + n(CX - wx * 0.18) + ' ' + n(hairlineY + 12) + ' ' + n(CX - wx * 0.45) + ' ' + n(hairlineY + 10) + ' ' + n(lx + 2) + ' ' + n(sideY) + ' Z';
    let s = '<path d="' + edge + '" fill="' + col + '" stroke="' + line + '" stroke-width="1.5"/>';
    if (style === 'bun') {
      s += '<circle cx="' + n(CX) + '" cy="' + n(TOP_Y - 10) + '" r="26" fill="' + col + '" stroke="' + line + '" stroke-width="1.5"/>';
    }
    if (bumpy) {
      // объём кудрей — гроздь кружков по куполу черепа
      const rx = wx + 8;
      const cy = m.browLineY - 16;
      const ry = (cy - TOP_Y) + 14;
      const dark = shade(col, 0.82);
      for (let i = 0; i <= 11; i++) {
        const ang = Math.PI * (i / 11); // слева направо по дуге
        const bx = CX - Math.cos(ang) * rx;
        const by = cy - Math.sin(ang) * ry;
        s += '<circle cx="' + n(bx) + '" cy="' + n(by) + '" r="16" fill="' + (i % 2 ? col : dark) + '"/>';
      }
    }
    return s;
  }

  /* ---------- растительность на лице ---------- */
  function facialHairGroup(m, profile) {
    const type = profile.values.facialHair;
    if (type === 'none') return '';
    const col = shade(hairColor(profile), 0.84);
    const y = m.mouthY;
    if (type === 'stubble') {
      // лёгкая тень по нижней части лица
      const jw = m.halves[4];
      return '<path d="M ' + n(CX - jw) + ' ' + n(m.noseBottomY) +
        ' Q ' + n(CX) + ' ' + n(m.chinY + 6) + ' ' + n(CX + jw) + ' ' + n(m.noseBottomY) +
        ' L ' + n(CX + jw) + ' ' + n(m.noseBottomY + 6) +
        ' Q ' + n(CX) + ' ' + n(m.chinY + 18) + ' ' + n(CX - jw) + ' ' + n(m.noseBottomY + 6) +
        ' Z" fill="' + col + '" opacity="0.28"/>';
    }
    let s = '';
    const mustache = '<path d="M ' + n(CX - 26) + ' ' + n(y - 12) +
      ' Q ' + n(CX) + ' ' + n(y - 4) + ' ' + n(CX + 26) + ' ' + n(y - 12) +
      ' Q ' + n(CX + 12) + ' ' + n(y - 2) + ' ' + n(CX) + ' ' + n(y - 2) +
      ' Q ' + n(CX - 12) + ' ' + n(y - 2) + ' ' + n(CX - 26) + ' ' + n(y - 12) + ' Z" fill="' + col + '"/>';
    if (type === 'mustache') return mustache;
    if (type === 'goatee') {
      s += mustache;
      s += '<path d="M ' + n(CX - 16) + ' ' + n(y + 12) + ' Q ' + n(CX) + ' ' + n(y + 8) + ' ' + n(CX + 16) + ' ' + n(y + 12) +
        ' Q ' + n(CX + 14) + ' ' + n(m.chinY - 6) + ' ' + n(CX) + ' ' + n(m.chinY) +
        ' Q ' + n(CX - 14) + ' ' + n(m.chinY - 6) + ' ' + n(CX - 16) + ' ' + n(y + 12) + ' Z" fill="' + col + '"/>';
      return s;
    }
    // борода: огибает нижнюю часть лица
    const jw = m.halves[4], jw2 = m.halves[5];
    const top = type === 'fullBeard' ? m.eyeLineY + 34 : m.noseBottomY;
    s += '<path d="M ' + n(CX - jw - 2) + ' ' + n(top) +
      ' C ' + n(CX - jw - 6) + ' ' + n(m.chinY) + ' ' + n(CX - jw2) + ' ' + n(m.chinY + 26) + ' ' + n(CX) + ' ' + n(m.chinY + 30) +
      ' C ' + n(CX + jw2) + ' ' + n(m.chinY + 26) + ' ' + n(CX + jw + 6) + ' ' + n(m.chinY) + ' ' + n(CX + jw + 2) + ' ' + n(top) +
      ' Q ' + n(CX) + ' ' + n(m.noseBottomY + 18) + ' ' + n(CX - jw - 2) + ' ' + n(top) + ' Z" fill="' + col + '"/>';
    s += mustache;
    return s;
  }

  /* ---------- очки ---------- */
  function glassesGroup(m, profile) {
    const type = profile.values.glasses;
    if (type === 'none') return '';
    const y = m.eyeLineY, dx = m.eyeDX;
    const rw = 30, rh = 22;
    const frame = type === 'sun' ? '#222' : '#3a3a3a';
    const lensFill = type === 'sun' ? '#222' : 'rgba(180,200,210,0.18)';
    function lens(cxx) {
      if (type === 'rounded' || type === 'sun') {
        return '<ellipse cx="' + n(cxx) + '" cy="' + n(y) + '" rx="' + rw + '" ry="' + rh + '" fill="' + lensFill + '" stroke="' + frame + '" stroke-width="3"/>';
      }
      return '<rect x="' + n(cxx - rw) + '" y="' + n(y - rh) + '" width="' + (rw * 2) + '" height="' + (rh * 2) + '" rx="6" fill="' + lensFill + '" stroke="' + frame + '" stroke-width="3"/>';
    }
    return lens(CX - dx) + lens(CX + dx) +
      '<path d="M ' + n(CX - dx + rw) + ' ' + n(y) + ' L ' + n(CX + dx - rw) + ' ' + n(y) + '" stroke="' + frame + '" stroke-width="3"/>' +
      '<path d="M ' + n(CX - dx - rw) + ' ' + n(y) + ' L ' + n(CX - m.halves[2]) + ' ' + n(y - 4) + '" stroke="' + frame + '" stroke-width="3"/>' +
      '<path d="M ' + n(CX + dx + rw) + ' ' + n(y) + ' L ' + n(CX + m.halves[2]) + ' ' + n(y - 4) + '" stroke="' + frame + '" stroke-width="3"/>';
  }

  /* ---------- особые приметы ---------- */
  function marksGroup(m, profile) {
    let s = '';
    (profile.marks || []).forEach((mark) => {
      if (mark === 'scarCheek') {
        s += '<path d="M ' + n(CX + m.halves[4] * 0.45) + ' ' + n(m.eyeLineY + 30) + ' l 6 34" stroke="#9a5a4a" stroke-width="3" stroke-linecap="round" opacity="0.8"/>';
      }
      if (mark === 'scarBrow') {
        s += '<path d="M ' + n(CX - m.eyeDX - 10) + ' ' + n(m.browLineY - 12) + ' l -10 -14" stroke="#9a5a4a" stroke-width="3" stroke-linecap="round" opacity="0.8"/>';
      }
      if (mark === 'moleCheek') {
        s += '<circle cx="' + n(CX - m.halves[4] * 0.4) + '" cy="' + n(m.noseBottomY) + '" r="3.4" fill="#5a3b28"/>';
      }
      if (mark === 'moleLip') {
        s += '<circle cx="' + n(CX + 22) + '" cy="' + n(m.mouthY + 12) + '" r="3" fill="#5a3b28"/>';
      }
      if (mark === 'freckles') {
        for (let i = 0; i < 18; i++) {
          const side = i % 2 ? 1 : -1;
          const fx = CX + side * (22 + (i * 7) % 40);
          const fy = m.noseBottomY - 10 + ((i * 11) % 26);
          s += '<circle cx="' + n(fx) + '" cy="' + n(fy) + '" r="1.7" fill="#a9764e" opacity="0.7"/>';
        }
      }
      if (mark === 'wrinkles') {
        s += '<path d="M ' + n(CX - m.eyeDX - 20) + ' ' + n(m.eyeLineY + 12) + ' q 6 6 0 12" stroke="#00000033" stroke-width="2" fill="none"/>';
        s += '<path d="M ' + n(CX + m.eyeDX + 20) + ' ' + n(m.eyeLineY + 12) + ' q -6 6 0 12" stroke="#00000033" stroke-width="2" fill="none"/>';
        s += '<path d="M ' + n(CX - 40) + ' ' + n(m.browLineY - 18) + ' q 40 -8 80 0" stroke="#00000022" stroke-width="2" fill="none"/>';
      }
    });
    return s;
  }

  /* ---------- объём: градиенты и мягкие тени ---------- */
  function defs(skin) {
    const light = shade(skin, 1.12);
    const mid = shade(skin, 0.86);
    const sh = shade(skin, 0.45);
    return '<defs>' +
      '<radialGradient id="skinGrad" cx="48%" cy="34%" r="68%">' +
        '<stop offset="0" stop-color="' + light + '"/>' +
        '<stop offset="0.6" stop-color="' + skin + '"/>' +
        '<stop offset="1" stop-color="' + mid + '"/>' +
      '</radialGradient>' +
      '<radialGradient id="softShadow" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="' + sh + '" stop-opacity="0.55"/>' +
        '<stop offset="1" stop-color="' + sh + '" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<radialGradient id="blush" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#d98a78" stop-opacity="0.30"/>' +
        '<stop offset="1" stop-color="#d98a78" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<radialGradient id="hi" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#fff6ea" stop-opacity="0.5"/>' +
        '<stop offset="1" stop-color="#fff6ea" stop-opacity="0"/>' +
      '</radialGradient>' +
      // мягкое размытие контурных теней — главный приём для «объёма», а не плоскости
      '<filter id="softBlur" x="-25%" y="-25%" width="150%" height="150%">' +
        '<feGaussianBlur stdDeviation="5"/></filter>' +
      // тонкая текстура кожи (мелкая крапчатость) — убирает «винил» плоской заливки
      '<filter id="skinTexture" x="0" y="0" width="100%" height="100%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n"/>' +
        '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0"/>' +
      '</filter>' +
      '</defs>';
  }

  function softEllipse(cx, cy, rx, ry, rot, op, fill) {
    return '<ellipse cx="' + n(cx) + '" cy="' + n(cy) + '" rx="' + n(rx) + '" ry="' + n(ry) + '" ' +
      'transform="rotate(' + n(rot) + ' ' + n(cx) + ' ' + n(cy) + ')" ' +
      'fill="' + (fill || 'url(#softShadow)') + '" opacity="' + op + '"/>';
  }

  // Мягкие тени поверх кожи (под чертами) — дают объём плоской заливке.
  // Тени собраны в группу под размытием — переходы света становятся плавными.
  function shading(m, profile) {
    const female = m.gender === 'female';
    const old = m.age === 'senior' || m.age === 'middle';
    let sh = '';
    // височно-скуловые впадины по бокам
    [+1, -1].forEach((side) => {
      sh += softEllipse(CX + side * m.halves[3] * 0.9, m.eyeLineY + 6, 26, 66, side * -10, 0.4);
      sh += softEllipse(CX + side * m.halves[4] * 0.88, m.noseBottomY + 6, 24, 40, side * 14, 0.36);
    });
    // направленная тень со стороны носа + лёгкая тень под кончиком (объём носа)
    sh += softEllipse(CX + 9, (m.noseTopY + m.noseBottomY) / 2 + 6, 9, (m.noseBottomY - m.noseTopY) / 2, 4, 0.34);
    sh += softEllipse(CX, m.noseBottomY + 9, 17, 8, 0, 0.3);
    // под нижней губой и под подбородком (на шее)
    sh += softEllipse(CX, m.mouthY + 22, 24, 11, 0, 0.3);
    sh += softEllipse(CX, m.chinY + 8, m.halves[5] * 0.8, 14, 0, 0.45);
    // носогубные складки — только для среднего/пожилого возраста
    if (old) {
      [+1, -1].forEach((side) => {
        sh += softEllipse(CX + side * 24, m.mouthY - 6, 7, 24, side * 12, 0.26);
      });
    }

    // блики — единый мягкий свет сверху: лоб, спинка и кончик носа, скулы, подбородок
    let li = '';
    li += softEllipse(CX, m.browLineY - m.faceH * 0.13, m.half * 0.44, m.faceH * 0.075, 0, 0.6, 'url(#hi)');
    li += softEllipse(CX - 4, (m.noseTopY + m.noseBottomY) / 2, 5, (m.noseBottomY - m.noseTopY) / 2 * 0.8, -3, 0.6, 'url(#hi)');
    li += softEllipse(CX, m.noseBottomY - 2, 6, 5, 0, 0.55, 'url(#hi)');
    [+1, -1].forEach((side) => {
      li += softEllipse(CX + side * m.halves[3] * 0.5, m.eyeLineY + 20, 24, 17, side * 8, 0.45, 'url(#hi)');
    });
    li += softEllipse(CX, m.chinY - 20, 17, 13, 0, 0.4, 'url(#hi)');

    // лёгкий румянец на щеках
    let bl = '';
    [+1, -1].forEach((side) => {
      bl += softEllipse(CX + side * m.halves[4] * 0.6, m.noseBottomY + 2, 20, 14, 0, female ? 0.9 : 0.5, 'url(#blush)');
    });
    return '<g filter="url(#softBlur)">' + sh + '</g>' + li + bl;
  }

  /* ---------- сборка ---------- */
  function buildSVG(profile, opts) {
    opts = opts || {};
    const m = metrics(profile);
    const skin = FC.traits.optionColor('skinTone', profile.values.skinTone) || '#eecaa8';
    const skinLine = shade(skin, 0.62);
    const head = headPath(m);

    // шея (чуть темнее лица — уходит в тень под подбородком)
    const neckW = m.halves[5] * 0.7;
    const neck = '<path d="M ' + n(CX - neckW) + ' ' + n(m.chinY - 18) +
      ' L ' + n(CX - neckW) + ' ' + n(VIEW_H) + ' L ' + n(CX + neckW) + ' ' + n(VIEW_H) +
      ' L ' + n(CX + neckW) + ' ' + n(m.chinY - 18) + ' Z" fill="' + shade(skin, 0.9) + '" stroke="' + skinLine + '" stroke-width="' + STROKE_W + '"/>';

    const bg = opts.transparent ? '' :
      '<rect x="0" y="0" width="' + VIEW_W + '" height="' + VIEW_H + '" fill="#f3f1ec"/>';

    const parts = [
      defs(skin),
      '<clipPath id="headClip"><path d="' + head + '"/></clipPath>',
      bg,
      hairBack(m, profile),
      neck,
      earsGroup(m, profile, skin, skinLine),
      '<path d="' + head + '" fill="url(#skinGrad)" stroke="' + skinLine + '" stroke-width="2.5"/>',
      // тонкая текстура кожи поверх заливки, отсечённая контуром лица
      '<g clip-path="url(#headClip)"><rect x="0" y="0" width="' + VIEW_W + '" height="' + VIEW_H + '" filter="url(#skinTexture)" opacity="0.5"/></g>',
      shading(m, profile),
      facialHairGroup(m, profile),
      browsGroup(m, profile),
      eyesGroup(m, profile),
      noseGroup(m, profile),
      mouthGroup(m, profile),
      glassesGroup(m, profile),
      hairFront(m, profile),
      marksGroup(m, profile),
    ];

    const inner = parts.join('');
    // bare — вернуть только содержимое (для вкладывания в лист-ориентировку)
    if (opts.bare) return inner;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" ' +
      'width="100%" height="100%" font-family="sans-serif" ' +
      'stroke-linejoin="round" stroke-linecap="round">' + inner + '</svg>';
  }

  FC.render = { buildSVG: buildSVG, metrics: metrics, VIEW_W: VIEW_W, VIEW_H: VIEW_H };
})(window.FC = window.FC || {});
