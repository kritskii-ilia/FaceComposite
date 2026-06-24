"""
nlu_test.py — офлайн-проверка локального матчера nlu.py.

Запуск:  python3 tests/nlu_test.py [путь_к_schema.json]

Схема берётся из traits.js. Удобно сгенерировать её рядом:
    node -e "const fs=require('fs');const w={};eval(fs.readFileSync('js/traits.js','utf8'));
             process.stdout.write(JSON.stringify(w.FC.traits.nluSchema()))" > schema.json

Если sentence-transformers не установлен, nlu.py сам падает на бесзависимостный
hashing-бэкенд — тест всё равно проходит сквозной конвейер. С реальной
семантической моделью точность заметно выше (синонимы, перефразировки).
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from nlu import get_nlu  # noqa: E402

# (описание, ожидаемые признаки) — проверяем, что нужные значения присутствуют.
CASES = [
    ("мужчина, овальное лицо, густые брови, прямой нос",
     {"gender": "male", "faceShape": "oval", "eyebrows": "thick", "nose": "straight"}),
    ("женщина с круглым лицом и пухлыми губами",
     {"gender": "female", "faceShape": "round", "lips": "full"}),
    ("нос картошкой", {"nose": "snub"}),
    ("большие голубые глаза", {"eyeColor": "blue"}),
    ("густая борода", {"facialHair": "fullBeard"}),
    ("лысый мужчина", {"hairStyle": "bald", "gender": "male"}),
    ("оттопыренные уши", {"ears": "protruding"}),
    ("тёмные короткие волосы", {"hairStyle": "short"}),
    ("курносый нос и веснушки", {"nose": "upturned"}),
    ("солнцезащитные очки", {"glasses": "sun"}),
]
# Приметы (множественные) проверяем отдельно.
MARK_CASES = [
    ("родинка на щеке", "moleCheek"),
    ("шрам у брови", "scarBrow"),
    ("веснушки", "freckles"),
]


def main():
    schema_path = sys.argv[1] if len(sys.argv) > 1 else "schema.json"
    if not os.path.isfile(schema_path):
        print("Не найден файл схемы:", schema_path)
        print("Сгенерируйте его из traits.js (см. docstring).")
        return 2
    schema = json.load(open(schema_path, encoding="utf-8"))
    nlu = get_nlu()
    print("Бэкенд:", nlu.status())
    print("-" * 64)

    ok, total = 0, 0
    for text, expect in CASES:
        res = nlu.interpret(text, schema)
        got = res["values"]
        for k, v in expect.items():
            total += 1
            hit = got.get(k) == v
            ok += hit
            mark = "OK " if hit else "FAIL"
            extra = "" if hit else "  (получено: %s)" % got.get(k)
            print("[%s] %-34s %s=%s%s" % (mark, text[:34], k, v, extra))

    for text, mk in MARK_CASES:
        res = nlu.interpret(text, schema)
        total += 1
        hit = mk in res["marks"]
        ok += hit
        print("[%s] %-34s mark=%s" % ("OK " if hit else "FAIL", text[:34], mk))

    print("-" * 64)
    rate = ok / total if total else 0
    print("Точность: %d/%d = %.0f%%" % (ok, total, rate * 100))
    # Порог намеренно скромный: на hashing-бэкенде синонимы вне списка фраз
    # матчатся слабее. С семантической моделью ожидается заметно выше.
    threshold = 0.6
    if rate < threshold:
        print("НИЖЕ ПОРОГА (%.0f%%) — проверьте бэкенд/фразы." % (threshold * 100))
        return 1
    print("Конвейер работает офлайн, контракт соблюдён.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
