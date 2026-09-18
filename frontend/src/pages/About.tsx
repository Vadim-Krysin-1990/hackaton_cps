import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../api'
import type { Health } from '../types'

/** Экран «как это работает». На защите он экономит минуту объяснений: жюри
 *  видит путь данных и то, чем подтверждён каждый ответ.
 *  Перепишите этапы под свою задачу — это витрина, а не документация. */
const STAGES = [
  { num: '1', title: 'Разбор реплик',
    items: ['Транскрипт .txt в любом виде', 'Кто говорит: интервьюер или сотрудник', 'Смещения реплик для подсветки'] },
  { num: '2', title: 'Настроение',
    items: ['Словарь, без модели, мгновенно', 'Оценка каждой реплики от −1 до 1', '«Говорит» и «чувствует» отдельно'] },
  { num: '3', title: 'Паспорт',
    items: ['Модель заполняет жёсткую JSON-схему', 'Промпт из файла prompts/', 'Повтор при невалидном JSON', 'Нет модели — запасной путь'] },
  { num: '4', title: 'Проверка цитат',
    items: ['Каждая цитата ищется в источнике', 'Точно или по схожести ≥ 82 %', 'Не нашлась — факт отклонён и показан'] },
  { num: '5', title: 'Результат',
    items: ['Карточка с подсветкой в тексте', 'DOCX для руководителя', 'Дашборд по всем интервью', 'Журнал и метрика «было / стало»'] },
]

const SCREENS = [
  { to: '/', name: 'Дашборд', what: 'причины ухода, частота проблем, риски, граф связей, что делать с главной, было / стало' },
  { to: '/interviews', name: 'Интервью', what: 'паспорта, подсветка цитат в оригинале, график настроения, повторный анализ другой моделью, DOCX' },
  { to: '/upload', name: 'Загрузка', what: 'один или несколько .txt, вставка текста, выбор модели' },
  { to: '/journal', name: 'Журнал', what: 'кто, что и когда сделал; длительность операций' },
]

export default function About() {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => { get<Health>('/health').then(setHealth).catch(() => {}) }, [])

  return (
    <>
      <div className="card">
        <h3 className="card-title">Как это работает</h3>
        <div className="grid cols-5">
          {STAGES.map(s => (
            <div key={s.num} className="stage">
              <div className="stage-num">{s.num}</div>
              <div className="typo-charts-header-2 mb-lg">{s.title}</div>
              <ul className="stage-list">
                {s.items.map(i => <li key={i}>{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-lg">
        <h3 className="card-title">Экраны</h3>
        <table className="table">
          <tbody>
            {SCREENS.map(s => (
              <tr key={s.to}>
                <td className="cell-main" style={{ width: 200 }}>
                  <Link to={s.to}>{s.name}</Link>
                </td>
                <td>{s.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mt-lg">
        <h3 className="card-title">Чем подтверждается работа контура</h3>
        <div className="typo-body-14 mb-lg">
          Эти значения отдаёт сервер, а не интерфейс: их видно и без входа, по адресу
          <span className="code-line">/api/health</span>
        </div>
        <table className="table">
          <tbody>
            <tr><td className="cell-main">База данных</td>
                <td>{health?.db ? 'работает' : 'недоступна'}</td></tr>
            <tr><td className="cell-main">Языковая модель</td>
                <td>{health?.llm_available
                      ? `${health.llm_model} · ${health.llm_provider} · ${health.llm_endpoint}`
                      : `недоступна${health?.llm_error ? ` — ${health.llm_error}` : ''}`}</td></tr>
            <tr><td className="cell-main">Промпты</td>
                <td>папка prompts/ в корне проекта, читаются при каждом анализе — правятся без перезапуска</td></tr>
            <tr><td className="cell-main">Без модели</td>
                <td>паспорт строится по ключевым словам с пометкой «fallback» в поле «движок»</td></tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
