/*
 * store.js — локальное хранение и экспорт. Всё строго офлайн:
 *   - проекты лежат в localStorage браузера (на этапе native-обёртки заменится
 *     на файловое хранилище в %APPDATA%, контракт сохраняем);
 *   - экспорт/импорт проекта — через скачивание/загрузку JSON-файла;
 *   - экспорт портрета — рендер SVG в PNG через canvas, без сети.
 */
(function (FC) {
  'use strict';

  const LS_KEY = 'facecomposite.cases.v1';

  function listCases() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveCase(caseObj) {
    const all = listCases();
    caseObj.updatedAt = new Date().toISOString();
    all[caseObj.id] = caseObj;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }
  function loadCase(id) { return listCases()[id] || null; }
  function deleteCase(id) {
    const all = listCases();
    delete all[id];
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function exportCaseJSON(caseObj) {
    const blob = new Blob([JSON.stringify(caseObj, null, 2)], { type: 'application/json' });
    download(safeName(caseObj.title) + '.fcase.json', blob);
  }

  function importCaseJSON(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { try { resolve(JSON.parse(r.result)); } catch (e) { reject(e); } };
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  // SVG-строка -> PNG-файл нужного масштаба.
  function exportPNG(svgString, filename, scale) {
    scale = scale || 2;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = FC.render.VIEW_W * scale, h = FC.render.VIEW_H * scale;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => download(filename, b), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Не удалось отрисовать PNG'); };
    img.src = url;
  }

  // Универсальный растровый экспорт SVG любого размера (для листа-ориентировки).
  function exportRasterPNG(svgString, w, h, filename, scale) {
    scale = scale || 2;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cw = w * scale, ch = h * scale;
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => download(filename, b), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Не удалось отрисовать лист'); };
    img.src = url;
  }

  function exportSVG(svgString, filename) {
    download(filename, new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
  }

  function safeName(s) {
    return (s || 'case').replace(/[^\wа-яА-ЯёЁ\- ]/g, '').trim().replace(/\s+/g, '_') || 'case';
  }

  FC.store = {
    listCases: listCases, saveCase: saveCase, loadCase: loadCase, deleteCase: deleteCase,
    exportCaseJSON: exportCaseJSON, importCaseJSON: importCaseJSON,
    exportPNG: exportPNG, exportRasterPNG: exportRasterPNG, exportSVG: exportSVG, safeName: safeName,
  };
})(window.FC = window.FC || {});
