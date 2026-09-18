import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../api'
import type { Health } from '../types'

/** Экран «как это работает». На защите он экономит минуту объяснений: жюри
 *  видит путь данных и то, чем подтверждён каждый ответ.
 *  Перепишите этапы под свою задачу — это витрина, а не документация. */
const STAGES = [
  { num: '1', title: 'Загрузка',
    items: ['Датасет задачи: XLSX, CSV', 'Документы: PDF, DOCX, XLSX, TXT, HTML'] },
  { num: '2', title: 'Разбор',
    items: ['Поиск строки заголовков', 'Распознавание ролей колонок',
            'Нормализация чисел', 'Отчёт о качестве данных'] },
  { num: '3', title: 'Хранение',
    items: ['База записей', 'Файлы документов', 'Векторный индекс фрагментов', 'Журнал событий'] },
  { num: '4', title: 'Анализ',
    items: ['Подбор записей по вопросу', 'Поиск фрагментов по смыслу', 'Сбор доказательной базы'] },
  { num: '5', title: 'Ответ',
    items: ['Модель формулирует ответ', 'Готовит письмо, записку, справку',
            'Каждый факт — со ссылкой на источник'] },
]

const SCREENS = [
  { to: '/', name: 'Обзор', what: 'что в данных и сколько времени экономит сервис' },
  { to: '/records', name: 'Данные', what: 'поиск, фильтры, карточка записи' },
  { to: '/assistant', name: 'Ассистент', what: 'вопросы по данным и документам со ссылками на источники' },
  { to: '/library', name: 'Библиотека', what: 'документы и поиск по смыслу' },
  { to: '/uploads', name: 'Загрузка', what: 'приём датасета и документов, отчёт о качестве' },
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
            <tr><td className="cell-main">Эмбеддинги</td>
                <td>{health?.embedder || '—'}
                  {health?.embedder === 'hash-fallback' &&
                    ' (быстрый фоллбэк; для качественного поиска поставьте backend/requirements-ml.txt)'}</td></tr>
            <tr><td className="cell-main">Векторное хранилище</td>
                <td>{health?.qdrant_mode === 'server' ? 'сервер Qdrant' : 'встроенное, папка data/qdrant'}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
