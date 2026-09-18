"""Генератор демонстрационного датасета.

Нужен в первый час: интерфейс должен показывать данные ещё до того, как
заказчик выложит настоящую выгрузку. Запуск:

    python backend/scripts/make_demo_data.py data/samples/demo.xlsx --rows 500
"""
from __future__ import annotations

import argparse
import random
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

CATEGORIES = ["Оборудование", "Строительство", "Услуги связи", "Проектирование", "Логистика"]
STATUSES = ["в работе", "на согласовании", "завершено", "приостановлено", "отменено"]
OBJECTS = ["Узел учёта", "Компрессорная", "Линия связи", "Подстанция", "Трубопровод", "Склад"]


def build(rows: int, seed: int = 42) -> pd.DataFrame:
    rnd = random.Random(seed)
    start = date.today() - timedelta(days=400)
    data = []
    for i in range(1, rows + 1):
        announced = start + timedelta(days=rnd.randint(0, 380))
        data.append({
            "Номер": f"ПР-{2026}-{i:05d}",
            "Наименование": f"{rnd.choice(OBJECTS)} №{rnd.randint(1, 99)}: "
                            f"{rnd.choice(['поставка', 'монтаж', 'обслуживание', 'разработка'])}",
            "Категория": rnd.choice(CATEGORIES),
            "Статус": rnd.choices(STATUSES, weights=[40, 25, 20, 10, 5])[0],
            "Сумма, руб": round(rnd.uniform(1e5, 9e7), 2),
            "Ответственный": rnd.choice(["Иванов И.И.", "Петров П.П.", "Сидорова А.В.",
                                         "Кузнецов Д.А.", "Орлова Е.С."]),
            "Дата начала": announced.isoformat(),
            "Срок": (announced + timedelta(days=rnd.randint(30, 210))).isoformat(),
            "Регион": rnd.choice(["Москва", "Санкт-Петербург", "Иркутск", "Тюмень", "Якутск"]),
        })
    return pd.DataFrame(data)


def main() -> None:
    ap = argparse.ArgumentParser(description="Демо-датасет для заготовки")
    ap.add_argument("out", nargs="?", default="data/samples/demo.xlsx", help="куда записать файл")
    ap.add_argument("--rows", type=int, default=500)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df = build(args.rows, args.seed)
    if out.suffix.lower() == ".csv":
        df.to_csv(out, index=False, sep=";", encoding="utf-8-sig")
    else:
        df.to_excel(out, index=False)
    print(f"Записано {len(df)} строк в {out}")


if __name__ == "__main__":
    main()
