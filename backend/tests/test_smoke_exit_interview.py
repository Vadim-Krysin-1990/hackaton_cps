"""Тесты конвейера экзит-интервью: разбор реплик, проверка цитат, запасной путь
без модели и API. Модель в тестах недоступна намеренно (см. conftest)."""
from __future__ import annotations

from app.domain.exit_interview import pipeline, verify
from app.domain.exit_interview.parsing import split_utterances

LABELED = """Интервьюер: Почему решили уйти?
Сотрудник: Если честно, всё упирается в деньги. Индексацию обещали в январе, потом перестали обещать.
Интервьюер: Что работало хорошо?
Сотрудник: Зато очень нравится, как устроен онбординг: ментор помогал реально.
"""

PLAIN = ("...Уходишь? Да, перехожу к конкурентам. Знаешь, сама работа классная, но убивает вот это: "
         "мы полгода обсуждаем ТЗ, а потом переделываем за неделю. Процесс согласования — это ад. "
         "...Что нравилось? Зато очень нравится, как устроен онбординг, ментор помогал реально, "
         "не то что в других местах. Ещё двое из отдела уже ходят по собеседованиям.")


def test_split_labeled():
    utts = split_utterances(LABELED)
    assert len(utts) == 4
    assert [u.speaker for u in utts] == ["interviewer", "employee", "interviewer", "employee"]
    # смещения указывают на текст реплики в исходнике — на этом держится подсветка
    assert LABELED[utts[1].start:utts[1].end] == utts[1].text


def test_split_plain_text():
    utts = split_utterances(PLAIN)
    assert len(utts) >= 3
    assert any(u.speaker == "interviewer" for u in utts)
    for u in utts:
        assert PLAIN[u.start:u.end] == u.text


def test_verify_exact_and_fuzzy():
    assert verify.locate("Процесс согласования — это ад", PLAIN)["found"]
    # модель слегка переписала цитату: находим по схожести
    loc = verify.locate("мы полгода обсуждаем ТЗ, потом переделываем за неделю", PLAIN)
    assert loc["found"] and loc["ratio"] >= 0.82
    # выдуманная фраза отклоняется
    assert not verify.locate("руководитель оскорблял меня при всех коллегах", PLAIN)["found"]


def test_verify_strips_hallucinated_quotes():
    passport = {
        "pain_points": [
            {"label": "согласования", "category": "процессы и согласования", "mentions": 1,
             "quotes": ["Процесс согласования — это ад", "нас заставляли работать по выходным"]},
            {"label": "выдумка", "category": "другое", "mentions": 1, "quotes": ["этого в тексте нет совсем"]},
        ],
        "best_practices": [{"label": "онбординг", "quote": "ментор помогал реально"}],
        "exit_reason_quote": "перехожу к конкурентам",
    }
    clean, report = verify.check_passport(passport, PLAIN)
    assert len(clean["pain_points"]) == 1
    assert clean["pain_points"][0]["quotes"] == ["Процесс согласования — это ад"]
    assert report["checked"] == 5 and report["accepted"] == 3 and len(report["rejected"]) == 2


def test_pipeline_fallback_without_model():
    r = pipeline.run(PLAIN)
    assert r["engine"] == "fallback"
    p = r["passport"]
    assert p["exit_reason"] in {"нереализованность", "карьера", "деньги", "микроклимат", "другое"}
    assert p["risk_zone"] == "High"                      # «ещё двое ходят по собеседованиям»
    assert any(pp["category"] == "процессы и согласования" for pp in p["pain_points"])
    assert len(p["improvement_suggestions"]) >= 3
    assert r["verification"]["rejected"] == []
    assert [s["step"] for s in r["steps"]] == ["parse", "sentiment", "extract", "verify", "done"]
    assert r["sentiment"]["points"]


def test_extract_json_tolerates_wrapping():
    raw = 'Вот результат:\n```json\n{"a": 1, "b": [2]}\n```'
    assert pipeline._extract_json(raw) == {"a": 1, "b": [2]}


def test_api_upload_and_dashboard(logged):
    files = [("files", ("beseda.txt", PLAIN.encode("utf-8"), "text/plain")),
             ("files", ("bad.pdf", b"%PDF", "application/pdf"))]
    body = logged.post("/api/interviews", files=files).json()
    assert len(body["items"]) == 1 and len(body["errors"]) == 1
    iid = body["items"][0]["id"]

    card = logged.get(f"/api/interviews/{iid}").json()
    assert card["passport"]["risk_zone"] == "High"
    assert card["analysis"]["verification"]["checked"] > 0

    dash = logged.get("/api/interviews/dashboard").json()
    assert dash["total"] >= 1 and dash["top_problem"]

    g = logged.get("/api/interviews/graph").json()
    kinds = {n["kind"] for n in g["nodes"]}
    assert {"interview", "reason", "problem"} <= kinds and g["edges"]

    ins = logged.get("/api/interviews/insight").json()
    assert ins["ready"] and ins["engine"].startswith("fallback") and len(ins["recommendations"]) >= 3
    # повторный вызов без новых интервью отдаёт кэш, а не строит заново
    assert logged.get("/api/interviews/insight").json()["created_at"] == ins["created_at"]

    r = logged.get(f"/api/interviews/{iid}/docx")
    assert r.status_code == 200 and len(r.content) > 5000

    short = logged.post("/api/interviews/text", json={"text": "слишком коротко"})
    assert short.status_code == 400

    assert logged.get("/api/interviews/models").json()["default"]
    assert logged.delete(f"/api/interviews/{iid}").json()["ok"]
