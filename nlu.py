"""
nlu.py — локальное (офлайн) понимание словесного описания внешности.

Задача слоя: произвольную фразу уложить в фиксированную схему признаков из
traits.js, не перечисляя правила вручную. Сравнение идёт ПО СМЫСЛУ — фрагменты
описания матчатся к примерам формулировок (NLU_PHRASES) через эмбеддинги.
Контракт выхода совпадает с extract.js:  {values, params, marks, evidence}.

ЖЁСТКОЕ ПРАВИЛО ПРОЕКТА: всё локально. Никакой сети, никаких облачных API.
Бэкенд эмбеддингов выбирается так:

  1. SentenceTransformerBackend — настоящая семантическая модель (multilingual),
     работает офлайн после однократной загрузки модели в models/ (как Vosk).
     Это рекомендуемый продакшен-путь.
  2. HashingBackend — бесзависимостный fallback на хешировании символьных
     n-грамм (нужен только numpy). Не «понимает» синонимы, но даёт устойчивость
     к падежам/опечаткам и позволяет всему конвейеру работать и тестироваться
     где угодно без скачивания модели.

Матчер от бэкенда не зависит: подключив более сильную модель, качество растёт
без изменения логики.
"""
import os
import re
import math

try:
    import numpy as np
    _NUMPY_OK = True
except Exception as e:  # pragma: no cover
    _NUMPY_OK = False
    _NUMPY_ERR = str(e)


# --------------------------------------------------------------------------
# Бэкенды эмбеддингов. Любой возвращает L2-нормированные векторы (np.ndarray).
# --------------------------------------------------------------------------

class SentenceTransformerBackend:
    """Локальная multilingual sentence-модель. Офлайн после загрузки модели.

    Путь к модели берётся из аргумента или из переменной окружения
    FC_NLU_MODEL. Если задан локальный каталог — сеть не нужна вовсе.
    Рекомендуемая модель: paraphrase-multilingual-MiniLM-L12-v2.
    """

    name = "sentence-transformers"

    def __init__(self, model_path=None):
        from sentence_transformers import SentenceTransformer  # ленивый импорт
        path = model_path or os.environ.get("FC_NLU_MODEL") \
            or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        # local_files_only=True для локального каталога — гарантия офлайна.
        local_only = os.path.isdir(path)
        self.model = SentenceTransformer(path) if not local_only \
            else SentenceTransformer(path, local_files_only=True)

    def encode(self, texts):
        return self.model.encode(
            list(texts), normalize_embeddings=True, convert_to_numpy=True
        )


class HashingBackend:
    """Бесзависимостный fallback: символьные n-граммы → хеш → вектор.

    Семантику синонимов не ловит, но общие n-граммы дают мягкое сходство
    однокоренных слов («густая»/«густые»). Полностью локальный, без модели.
    """

    name = "hashing"

    def __init__(self, dim=512, ngram=(3, 4)):
        self.dim = dim
        self.ngram = ngram

    def _vec(self, text):
        v = np.zeros(self.dim, dtype=np.float32)
        t = " " + re.sub(r"\s+", " ", text.lower().strip()) + " "
        for n in range(self.ngram[0], self.ngram[1] + 1):
            for i in range(len(t) - n + 1):
                g = t[i:i + n]
                h = hash(g) % self.dim
                v[h] += 1.0
        nrm = np.linalg.norm(v)
        return v / nrm if nrm > 0 else v

    def encode(self, texts):
        return np.vstack([self._vec(t) for t in texts])


def _make_backend(model_path=None):
    """Выбрать сильнейший доступный локальный бэкенд."""
    if not _NUMPY_OK:
        raise RuntimeError("numpy не установлен: " + _NUMPY_ERR)
    try:
        return SentenceTransformerBackend(model_path)
    except Exception:
        return HashingBackend()


# --------------------------------------------------------------------------
# Сегментация описания на короткие смысловые фрагменты.
# --------------------------------------------------------------------------

# Режем по запятым/точкам/«и»/«с», скользящим окном захватываем 1–3 слова —
# чтобы «нос картошкой» и «большие карие глаза» попадали целыми кусками.
_SPLIT = re.compile(r"[,.;:]| и | с | а ", re.IGNORECASE)


def _fragments(text):
    out = []
    for chunk in _SPLIT.split(text):
        words = [w for w in re.split(r"\s+", chunk.strip()) if w]
        if not words:
            continue
        out.append(" ".join(words))            # фраза целиком
        for n in (2, 3):                        # + скользящие окна 2–3 слова
            for i in range(len(words) - n + 1):
                out.append(" ".join(words[i:i + n]))
    # уникализуем, сохраняя порядок
    seen, uniq = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    return uniq


# --------------------------------------------------------------------------
# Основной матчер.
# --------------------------------------------------------------------------

class NLU:
    """Интерпретатор описания. Индекс кандидатов строится из схемы (traits.js)
    и кэшируется; пересборка — только если схема изменилась."""

    def __init__(self, model_path=None):
        self.backend = None
        self.model_path = model_path
        self._schema_key = None
        self._cands = None      # список кандидатов
        self._mat = None        # матрица их эмбеддингов
        self.error = ""

    # --- доступность (для моста в app.py) ---
    def available(self):
        try:
            if self.backend is None:
                self.backend = _make_backend(self.model_path)
            return self.backend is not None
        except Exception as e:
            self.error = str(e)
            return False

    def status(self):
        if not _NUMPY_OK:
            return "numpy не установлен"
        if self.backend is None:
            self.available()
        return ("ok · бэкенд: " + self.backend.name) if self.backend else (self.error or "недоступно")

    # --- построение индекса кандидатов из схемы ---
    def _candidates(self, schema):
        """Каждый кандидат: что выставить и какой текст с ним сопоставляем.
        kind: select | slider | mark."""
        cands = []
        for s in schema.get("selects", []):
            for o in s["options"]:
                texts = [o["label"]] + list(o.get("phrases", []))
                for txt in texts:
                    cands.append({"kind": "select", "key": s["key"],
                                  "value": o["value"], "text": txt})
        for s in schema.get("sliders", []):
            for ph in s.get("phrases", []):
                cands.append({"kind": "slider", "key": s["key"],
                              "value": ph["value"], "text": ph["text"]})
        for m in schema.get("marks", []):
            texts = [m["label"]] + list(m.get("phrases", []))
            for txt in texts:
                cands.append({"kind": "mark", "value": m["value"], "text": txt})
        return cands

    def _ensure_index(self, schema):
        key = repr(schema)
        if key == self._schema_key and self._mat is not None:
            return
        if not self.available():
            raise RuntimeError(self.status())
        self._cands = self._candidates(schema)
        self._mat = self.backend.encode([c["text"] for c in self._cands])
        self._schema_key = key

    @staticmethod
    def _conf(score, backend_name):
        """Полоса уверенности по близости. Шкалы у бэкендов разные."""
        if backend_name == "hashing":
            hi, md = 0.62, 0.42
        else:  # семантическая модель
            hi, md = 0.72, 0.55
        if score >= hi:
            return "high"
        if score >= md:
            return "med"
        return "low"

    # --- основной вызов ---
    def interpret(self, text, schema):
        """Вернуть {values, params, marks, evidence}. По каждому признаку —
        лучший фрагмент описания выше порога. Категории/приметы не дублируются."""
        out = {"values": {}, "params": {}, "marks": [], "evidence": []}
        text = (text or "").strip()
        if not text:
            return out
        try:
            self._ensure_index(schema)
        except Exception as e:
            self.error = str(e)
            return out

        frags = _fragments(text)
        if not frags:
            return out
        femb = self.backend.encode(frags)            # (F, d)
        sims = femb @ self._mat.T                     # (F, C) косинус (норм-векторы)

        bname = self.backend.name
        floor = 0.42 if bname == "hashing" else 0.55  # ниже — игнор

        # Для каждого кандидата берём лучший фрагмент; затем по каждому признаку
        # (select.key / slider.key / mark.value) — кандидат с макс. близостью.
        best_per_target = {}   # target_id -> dict(score, cand, frag)
        for ci, cand in enumerate(self._cands):
            fi = int(np.argmax(sims[:, ci]))
            score = float(sims[fi, ci])
            if score < floor:
                continue
            if cand["kind"] == "select":
                tid = "sel:" + cand["key"]
            elif cand["kind"] == "slider":
                tid = "sli:" + cand["key"]
            else:
                tid = "mark:" + cand["value"]
            cur = best_per_target.get(tid)
            if cur is None or score > cur["score"]:
                best_per_target[tid] = {"score": score, "cand": cand, "frag": frags[fi]}

        for tid, b in best_per_target.items():
            cand, score, frag = b["cand"], b["score"], b["frag"]
            conf = self._conf(score, bname)
            if cand["kind"] == "select":
                out["values"][cand["key"]] = cand["value"]
                out["evidence"].append({"trait": cand["key"], "value": cand["value"],
                                        "match": frag, "conf": conf, "src": "nlu",
                                        "score": round(score, 3)})
            elif cand["kind"] == "slider":
                out["params"][cand["key"]] = cand["value"]
                out["evidence"].append({"trait": cand["key"], "value": cand["value"],
                                        "match": frag, "conf": conf, "src": "nlu",
                                        "score": round(score, 3)})
            else:
                if cand["value"] not in out["marks"]:
                    out["marks"].append(cand["value"])
                    out["evidence"].append({"trait": "mark", "value": cand["value"],
                                            "match": frag, "conf": conf, "src": "nlu",
                                            "score": round(score, 3)})
        return out


# Удобная обёртка-синглтон для моста pywebview.
_INSTANCE = None


def get_nlu(model_path=None):
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = NLU(model_path)
    return _INSTANCE
