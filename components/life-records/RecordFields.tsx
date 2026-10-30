'use client'

import { LIFE_RECORD_LABELS, LIFE_RECORD_TYPES, type LifeRecordDraft, type LifeRecordType } from '@/lib/life-records'

interface Props {
  record: LifeRecordDraft
  onChange: (record: LifeRecordDraft) => void
}

const inputClass = 'w-full rounded-xl border border-cyan-300/25 bg-[#101e38] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300'

export default function RecordFields({ record, onChange }: Props) {
  function update(patch: Partial<LifeRecordDraft>) { onChange({ ...record, ...patch }) }
  function changeType(type: LifeRecordType) {
    if (type === record.type) return
    onChange({
      type,
      date: record.date,
      note: record.note,
      ...(type === 'exercise' ? { activity: record.sourceRef?.text.slice(0, 40) ?? record.activity } : {}),
      ...(type === 'expense' ? { currency: 'CNY' as const } : {}),
      ...(type === 'learning' ? { subject: record.sourceRef?.text.slice(0, 40) ?? record.subject } : {}),
      ...(type === 'meal' ? { food: record.sourceRef?.text.slice(0, 120) ?? record.food } : {}),
      sourceRef: record.sourceRef
        ? {
            ...record.sourceRef,
            candidateType: record.sourceRef.candidateType ?? record.type,
            confirmedType: type,
            userEdited: true,
          }
        : undefined,
      attachments: record.attachments,
    })
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-muted">类型
        <select className={inputClass} value={record.type} onChange={event => changeType(event.target.value as LifeRecordType)}>
          {LIFE_RECORD_TYPES.map(type => <option key={type} value={type}>{LIFE_RECORD_LABELS[type]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">日期
        <input className={inputClass} type="date" value={record.date} onChange={event => update({ date: event.target.value })} />
      </label>
      {record.type === 'exercise' && <>
        <label className="grid gap-1 text-xs text-muted">运动项目
          <input className={inputClass} value={record.activity ?? ''} onChange={event => update({ activity: event.target.value })} placeholder="例如：跑步" />
        </label>
        <label className="grid gap-1 text-xs text-muted">时长（分钟，可选）
          <input className={inputClass} type="number" min="1" max="1440" step="1" value={record.durationMinutes ?? ''} onChange={event => update({ durationMinutes: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">重量（公斤，可选）
          <input className={inputClass} type="number" min="0.1" max="1000" step="0.1" value={record.weightKg ?? ''} onChange={event => update({ weightKg: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">组数（可代替时长）
          <input className={inputClass} type="number" min="1" max="100" step="1" value={record.sets ?? ''} onChange={event => update({ sets: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">每组次数（可选）
          <input className={inputClass} type="number" min="1" max="1000" step="1" value={record.repsPerSet ?? ''} onChange={event => update({ repsPerSet: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
      </>}
      {record.type === 'sleep' && <label className="grid gap-1 text-xs text-muted">睡眠时长（小时）
        <input className={inputClass} type="number" min="0.1" max="24" step="0.1" value={record.hours || ''} onChange={event => update({ hours: Number(event.target.value) })} />
      </label>}
      {record.type === 'sleep' && <label className="grid gap-1 text-xs text-muted">醒来感受（可选）
        <input className={inputClass} maxLength={120} value={record.wakeFeeling ?? ''} onChange={event => update({ wakeFeeling: event.target.value || undefined })} placeholder="例如：仍然困倦、身体疲惫" />
      </label>}
      {record.type === 'learning' && <>
        <label className="grid gap-1 text-xs text-muted">学习内容
          <input className={inputClass} maxLength={40} value={record.subject ?? ''} onChange={event => update({ subject: event.target.value })} placeholder="例如：英语、阅读、电工题" />
        </label>
        <label className="grid gap-1 text-xs text-muted">学习时长（分钟，可选）
          <input className={inputClass} type="number" min="1" max="1440" step="1" value={record.durationMinutes ?? ''} onChange={event => update({ durationMinutes: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">完成数量（可代替时长）
          <input className={inputClass} type="number" min="1" max="100000" step="1" value={record.quantity ?? ''} onChange={event => update({ quantity: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">数量单位
          <input className={inputClass} maxLength={8} value={record.unit ?? ''} onChange={event => update({ unit: event.target.value })} placeholder="例如：题、页" />
        </label>
      </>}
      {record.type === 'expense' && <label className="grid gap-1 text-xs text-muted">消费金额（元）
        <input className={inputClass} type="number" min="0.01" step="0.01" value={record.amount || ''} onChange={event => update({ amount: Number(event.target.value) })} />
      </label>}
      {record.type === 'meal' && <label className="grid gap-1 text-xs text-muted sm:col-span-2">吃了什么
        <input className={inputClass} maxLength={120} value={record.food ?? ''} onChange={event => update({ food: event.target.value })} placeholder="例如：米饭、鸡蛋、青菜" />
      </label>}
      {record.type === 'mood' && <label className="grid gap-1 text-xs text-muted">心情评分
        <select className={inputClass} value={record.score ?? ''} onChange={event => update({ score: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">不评分，直接保存</option>
          {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} 分</option>)}
        </select>
        <span className="text-cyan-200">
          {record.score === undefined ? '评分可选。心情描述会正常保存，但不计入评分均值。' : '该评分由你明确选择；可重新选择「不评分」移除。'}
        </span>
      </label>}
      <label className="grid gap-1 text-xs text-muted sm:col-span-2">备注
        <input className={inputClass} maxLength={200} value={record.note} onChange={event => update({ note: event.target.value })} placeholder="可选" />
      </label>
    </div>
  )
}
