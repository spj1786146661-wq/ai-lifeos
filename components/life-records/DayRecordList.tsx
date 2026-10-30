'use client'

import { useEffect, useRef } from 'react'
import { LIFE_RECORD_VISUALS } from '@/lib/life-calendar.ts'
import { lifeRecordSummary, type LifeRecord, type LifeRecordType } from '@/lib/life-records'

interface Props {
  date: string
  records: LifeRecord[]
  /** null 表示总日历；具体类型表示分类日历，只应传入该分类记录。 */
  typeFilter: LifeRecordType | null
  onEdit: (record: LifeRecord) => void
  onDelete: (record: LifeRecord) => void
  busy: boolean
}

export default function DayRecordList({ date, records, typeFilter, onEdit, onDelete, busy }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const key = `${date}:${typeFilter ?? 'all'}`

  // 日期或分类变化时重放列表进入动画；连续快速切换不会残留旧动画。
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    node.classList.remove('aios-list-enter')
    void node.offsetWidth
    node.classList.add('aios-list-enter')
  }, [key])

  const title = typeFilter ? `${LIFE_RECORD_VISUALS[typeFilter].label}记录` : '当天全部记录'

  return <section className="space-y-3" aria-label={title}>
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-bold">{title}</h3>
      <span className="font-mono text-[11px] text-muted">{records.length} 条</span>
    </div>
    <div ref={listRef} className="space-y-2">
      {records.length === 0 && <p className="card text-sm text-muted">
        {typeFilter ? `${date} 没有${LIFE_RECORD_VISUALS[typeFilter].label}记录。` : `${date} 暂无记录。`}
      </p>}
      {records.map(record => {
        const visual = LIFE_RECORD_VISUALS[record.type]
        return <article key={record.id} className="rounded-2xl border p-3" style={{ borderColor: `${visual.color}33`, backgroundColor: visual.background }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: visual.color }} aria-hidden="true" />
                <span style={{ color: visual.color }}>{visual.label}</span>
                <span className="font-mono">{visual.english}</span>
                {record.createdAt && <span className="font-mono">{new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <p className="mt-1 break-words text-sm font-semibold leading-6">{lifeRecordSummary(record)}</p>
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button type="button" className="-my-2 flex min-h-11 min-w-11 items-center px-2 text-cyan-300" onClick={() => onEdit(record)}>修改</button>
              <button type="button" disabled={busy} className="-my-2 flex min-h-11 min-w-11 items-center px-2 text-red-300 disabled:opacity-50" onClick={() => onDelete(record)}>删除</button>
            </div>
          </div>
          {record.note && <p className="mt-1 text-xs text-muted">备注：{record.note}</p>}
          {record.sourceText && <p className="mt-1 text-xs text-muted">原话：{record.sourceText}</p>}
        </article>
      })}
    </div>
  </section>
}
