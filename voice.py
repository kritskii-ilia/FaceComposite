"""
voice.py — офлайн распознавание речи (русский) через Vosk.

Полностью локально, без сети: микрофон захватывается через sounddevice,
аудио потоково отдаётся в Vosk. Работает только в нативном режиме (app.py),
т.к. требует доступа к микрофону и локальной модели. В чистом браузере
функция недоступна — это осознанно (офлайн-голос — функция «приложения»).

Зависимости: vosk, sounddevice. Модель: models/vosk-model-small-ru-0.22.
"""
import os
import json
import queue
import threading

try:
    import sounddevice as sd
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
    _DEPS_OK = True
    _DEPS_ERR = ""
except Exception as e:  # pragma: no cover
    _DEPS_OK = False
    _DEPS_ERR = str(e)

SAMPLE_RATE = 16000


class Dictation:
    def __init__(self, model_dir):
        self.model_dir = model_dir
        self.model = None
        self.rec = None
        self.stream = None
        self.q = queue.Queue()
        self.running = False
        self.parts = []
        self.partial = ""
        self.error = ""
        self.preferred_device = None  # индекс устройства, выбранный оператором (None = авто)

    def set_device(self, index):
        """Запомнить устройство ввода для следующего start(). index=None/-1 — авто
        (системное по умолчанию, либо первый найденный микрофон)."""
        self.preferred_device = None if index is None or index == -1 else index

    def list_devices(self):
        """Микрофоны системы: [{index, name}]. Пусто — если sounddevice недоступен
        или их нет. Используется для выпадающего списка в UI оператора."""
        if not _DEPS_OK:
            return []
        out = []
        try:
            for i, dev in enumerate(sd.query_devices()):
                if dev.get("max_input_channels", 0) > 0:
                    out.append({"index": i, "name": dev.get("name", "Микрофон %d" % i)})
        except Exception:
            return []
        return out

    def available(self):
        return _DEPS_OK and os.path.isdir(self.model_dir)

    def status(self):
        if not _DEPS_OK:
            return "Не установлены vosk/sounddevice: " + _DEPS_ERR
        if not os.path.isdir(self.model_dir):
            return "Не найдена модель: " + self.model_dir
        return "ok"

    def _load_model(self):
        if self.model is None:
            self.model = Model(self.model_dir)

    def _on_audio(self, indata, frames, time_info, status):
        self.q.put(bytes(indata))

    def _input_device(self):
        """Вернуть индекс входного устройства; None — использовать системное по
        умолчанию. Если умолчания нет (-1), берём первый микрофон в системе.
        Явный выбор оператора (set_device) имеет приоритет над автовыбором."""
        if self.preferred_device is not None:
            return self.preferred_device
        try:
            dd = sd.default.device
            di = dd[0] if isinstance(dd, (list, tuple)) else dd
            if di is not None and di != -1:
                return None
        except Exception:
            pass
        try:
            for i, dev in enumerate(sd.query_devices()):
                if dev.get("max_input_channels", 0) > 0:
                    return i
        except Exception:
            pass
        return None

    def start(self):
        if not self.available():
            self.error = self.status()
            return False
        if self.running:
            return True
        try:
            self._load_model()
            self.rec = KaldiRecognizer(self.model, SAMPLE_RATE)
            self.parts = []
            self.partial = ""
            self.q = queue.Queue()
            self.running = True
            self.stream = sd.RawInputStream(
                samplerate=SAMPLE_RATE, blocksize=8000, dtype="int16",
                channels=1, callback=self._on_audio, device=self._input_device(),
            )
            self.stream.start()
            threading.Thread(target=self._worker, daemon=True).start()
            return True
        except Exception as e:
            self.error = str(e)
            self.running = False
            return False

    def _worker(self):
        while self.running:
            try:
                data = self.q.get(timeout=0.3)
            except queue.Empty:
                continue
            if self.rec.AcceptWaveform(data):
                txt = json.loads(self.rec.Result()).get("text", "")
                if txt:
                    self.parts.append(txt)
                self.partial = ""
            else:
                self.partial = json.loads(self.rec.PartialResult()).get("partial", "")

    def get_partial(self):
        return (" ".join(self.parts) + " " + self.partial).strip()

    def stop(self):
        if not self.running:
            return self._final()
        self.running = False
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass
        try:
            txt = json.loads(self.rec.FinalResult()).get("text", "")
            if txt:
                self.parts.append(txt)
        except Exception:
            pass
        return self._final()

    def _final(self):
        return " ".join(p for p in self.parts if p).strip()
