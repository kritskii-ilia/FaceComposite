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

# В упакованном виде (PyInstaller) ресурсы лежат во временной папке _MEIPASS,
# в обычном запуске — рядом с app.py.
if getattr(sys, "frozen", False):
    BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(BASE_DIR, "index.html")
MODEL_DIR = os.path.join(BASE_DIR, "models", "vosk-model-small-ru-0.22")


class Api:
    """Мост в JS: window.pywebview.api.* — офлайн голосовой ввод."""

    def __init__(self, model_dir):
        self.dictation = Dictation(model_dir)

    def voice_available(self):
        return self.dictation.available()

    def voice_status(self):
        return self.dictation.status()

    def voice_start(self):
        return self.dictation.start()

    def voice_partial(self):
        return self.dictation.get_partial()

    def voice_stop(self):
        return self.dictation.stop()


def main():
    if not os.path.exists(INDEX):
        sys.stderr.write("Не найден index.html рядом с app.py\n")
        sys.exit(1)

    api = Api(MODEL_DIR)
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
