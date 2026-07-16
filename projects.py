"""
projects.py — файловое хранилище проектов (карточек) для нативного приложения.

Каждая карточка — отдельный JSON-файл <id>.json в каталоге данных приложения
(%APPDATA%\\FaceComposite\\projects на Windows). Это делает проекты видимыми и
переносимыми файлами (бэкап, перенос на другую машину, чистый переустановленный
.exe), а не спрятанными записями внутри профиля WebView2, которые пропадают
вместе с ним при переустановке.

Используется как фоновое зеркало поверх основного хранилища — localStorage
(js/store.js): контракт listCases/saveCase/loadCase/deleteCase совпадает,
но здесь всё синхронный доступ к диску, а мост pywebview на JS-стороне сам
решает, когда звать эти функции (см. store.js: syncFromNative + best-effort
запись при каждом saveCase/deleteCase).
"""
import os
import re
import json

_ID_SAFE = re.compile(r"[^a-zA-Z0-9_\-]")


def data_dir():
    """Каталог с файлами проектов. На Windows — %APPDATA%\\FaceComposite\\projects.
    Вне Windows (разработка/тесты) — аналог в домашнем каталоге пользователя."""
    root = os.environ.get("APPDATA")
    if not root:
        root = os.path.join(os.path.expanduser("~"), ".local", "share")
    path = os.path.join(root, "FaceComposite", "projects")
    os.makedirs(path, exist_ok=True)
    return path


def _path_for(case_id):
    safe = _ID_SAFE.sub("_", str(case_id)) or "case"
    return os.path.join(data_dir(), safe + ".json")


def list_cases():
    """Все карточки: {id: caseObj}. Повреждённый файл пропускается, а не
    роняет весь список — один битый JSON не должен блокировать остальные."""
    out = {}
    d = data_dir()
    try:
        names = os.listdir(d)
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, name), "r", encoding="utf-8") as f:
                obj = json.load(f)
            if isinstance(obj, dict) and obj.get("id"):
                out[obj["id"]] = obj
        except Exception:
            continue
    return out


def save_case(case_obj):
    if not isinstance(case_obj, dict) or not case_obj.get("id"):
        raise ValueError("case_obj должен быть словарём с полем id")
    with open(_path_for(case_obj["id"]), "w", encoding="utf-8") as f:
        json.dump(case_obj, f, ensure_ascii=False, indent=2)
    return True


def load_case(case_id):
    try:
        with open(_path_for(case_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def delete_case(case_id):
    try:
        os.remove(_path_for(case_id))
    except OSError:
        pass
    return True
