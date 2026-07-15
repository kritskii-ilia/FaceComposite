"""
Нативная Windows-обёртка для конструктора фоторобота.

Открывает тот же локальный фронтенд (index.html) в настоящем десктоп-окне через
WebView2 (движок Edge). Это превращает «вкладку браузера» в полноценное приложение
для выставки и задаёт продуктовый путь к самостоятельному .exe (см. build_exe.bat).

Зависимости (ставятся один раз):  py -m pip install pywebview
Запуск:                           py app.py   (или двойной клик «Запустить.bat»)
"""
import os
import sys

import webview

from voice import Dictation
from nlu import get_nlu

# В упакованном виде (PyInstaller) ресурсы лежат во временной папке _MEIPASS,
# в обычном запуске — рядом с app.py.
if getattr(sys, "frozen", False):
    BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(BASE_DIR, "index.html")
MODEL_DIR = os.path.join(BASE_DIR, "models", "vosk-model-small-ru-0.22")
# Локальная модель эмбеддингов для NLU (если положена рядом). Если каталога нет —
# nlu.py сам выберет доступный бэкенд (вплоть до бесзависимостного hashing).
NLU_MODEL_DIR = os.path.join(BASE_DIR, "models", "nlu")
if not os.path.isdir(NLU_MODEL_DIR):
    NLU_MODEL_DIR = None


class Api:
    """Мост в JS: window.pywebview.api.* — офлайн голосовой ввод и
    нейросетевое понимание описания (оба полностью локальные)."""

    def __init__(self, model_dir, nlu_model_dir=None):
        self.dictation = Dictation(model_dir)
        # NLU грузится лениво (при первом обращении), чтобы не тормозить старт.
        self._nlu_model_dir = nlu_model_dir
        self._nlu = None

    def voice_available(self):
        return self.dictation.available()

    def voice_status(self):
        return self.dictation.status()

    def voice_devices(self):
        return self.dictation.list_devices()

    def voice_set_device(self, index):
        self.dictation.set_device(index)
        return True

    def voice_start(self):
        return self.dictation.start()

    def voice_partial(self):
        return self.dictation.get_partial()

    def voice_stop(self):
        return self.dictation.stop()

    # ---- нейросетевое понимание описания (этап 1, локально/офлайн) ----
    def _get_nlu(self):
        if self._nlu is None:
            self._nlu = get_nlu(self._nlu_model_dir)
        return self._nlu

    def nlu_available(self):
        try:
            return self._get_nlu().available()
        except Exception:
            return False

    def nlu_status(self):
        try:
            return self._get_nlu().status()
        except Exception as e:
            return str(e)

    def interpret(self, text, schema):
        """text + схема признаков (из traits.js) → {values, params, marks, evidence}.
        Тот же контракт, что и у extract.js, — используется как fallback к регекспам."""
        try:
            return self._get_nlu().interpret(text, schema)
        except Exception as e:
            return {"values": {}, "params": {}, "marks": [], "evidence": [], "error": str(e)}


def main():
    if not os.path.exists(INDEX):
        sys.stderr.write("Не найден index.html рядом с app.py\n")
        sys.exit(1)

    api = Api(MODEL_DIR, NLU_MODEL_DIR)
    webview.create_window(
        title="Фоторобот — конструктор",
        url=INDEX,
        js_api=api,
        width=1500,
        height=950,
        min_size=(1100, 720),
        background_color="#14171c",
        text_select=False,
    )
    # http_server=True — фронтенд отдаётся через локальный http-origin, чтобы
    # стабильно работало сохранение проектов (localStorage) и будущие модули.
    webview.start(http_server=True)


if __name__ == "__main__":
    main()
