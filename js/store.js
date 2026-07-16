/*
 * store.js — локальное хранение и экспорт. Всё строго офлайн:
 *   - проекты лежат в localStorage браузера (быстрое синхронное хранилище —
 *     весь остальной код читает/пишет проекты синхронно и это не меняем);
 *   - в нативном приложении (.exe / Запустить.bat) поверх localStorage работает
 *     файловое зеркало в %APPDATA%\FaceComposite\projects (см. projects.py):
 *     saveCase/deleteCase best-effort дублируют туда запись в фоне, а
 *     syncFromNative() при старте подтягивает файлы обратно в localStorage.
 *     Так проекты переживают переустановку .exe или перенос на другую
 *     машину — localStorage привязан к профилю WebView2 и при переустановке
 *     пропадает, файлы — нет;
 *   - экспорт/импорт проекта — через скачивание/загрузку JSON-файла;
 *   - экспорт портрета — рендер SVG в PNG через canvas, без сети.
 */
(function (FC) {
  'use strict';

  const LS_KEY = 'facecomposite.cases.v1';

  function projectsApi() {
    return (window.pywebview && window.pywebview.api && window.pywebview.api.projects_list)
      ? window.pywebview.api : null;
  }

  function readLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeLS(all) { localStorage.setItem(LS_KEY, JSON.stringify(all)); }

  function listCases() { return readLS(); }

  function saveCase(caseObj) {
    const all = readLS();
    caseObj.updatedAt = new Date().toISOString();
    all[caseObj.id] = caseObj;
    writeLS(all);
    // Файловая копия — best-effort и в фоне: не блокирует и не может сорвать
    // основное сохранение в localStorage, даже если мост недоступен/упал.
    const api = projectsApi();
    if (api) { try { api.projects_save(caseObj).catch(() => {}); } catch (e) { /* ignore */ } }
  }
  function loadCase(id) { return readLS()[id] || null; }
  function deleteCase(id) {
    const all = readLS();
    delete all[id];
    writeLS(all);
    const api = projectsApi();
    if (api) { try { api.projects_delete(id).catch(() => {}); } catch (e) { /* ignore */ } }
  }

  // Вызывается один раз при старте нативного приложения (пока UI ещё не читал
  // список проектов). Подтягивает файлы поверх localStorage там, где файл
  // новее (или запись в localStorage вовсе отсутствует, например после
  // переустановки .exe). Возвращает true, если что-то реально обновилось —
  // вызывающий код может решить перерисовать список проектов.
  function syncFromNative() {
    const api = projectsApi();
    if (!api) return Promise.resolve(false);
    return api.projects_list().then((fileCases) => {
      if (!fileCases || !Object.keys(fileCases).length) return false;
      const ls = readLS();
      let changed = false;
      Object.keys(fileCases).forEach((id) => {
        const f = fileCases[id], l = ls[id];
        if (!l || (f.updatedAt || '') > (l.updatedAt || '')) { ls[id] = f; changed = true; }
      });
      if (changed) writeLS(ls);
      return changed;
    }).catch(() => false);
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
    syncFromNative: syncFromNative,
    exportCaseJSON: exportCaseJSON, importCaseJSON: importCaseJSON,
    exportPNG: exportPNG, exportRasterPNG: exportRasterPNG, exportSVG: exportSVG, safeName: safeName,
  };
})(window.FC = window.FC || {});
