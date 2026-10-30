'use client'

import { countRecordedDays, summarizeLifeRecords, type LifeRecord, type LifeRecordType } from '@/lib/life-records'

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Circular SVG progress follows the focus timer in karim-coder/life-os (MIT)
// and the original LifeTracker command center. The ring measures days logged, not a goal.
function RecordRing({ color, days, english, label, onClick, selected }: { color: string; days: number; english: string; label: string; onClick: () => void; selected: boolean }) {
  const radius = 43
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(days / 7, 1)
  return <button type="button" onClick={onClick} aria-label={`查看${label}历史记录，近 7 天记录了 ${days} 天`} aria-pressed={selected} className={'flex min-w-0 flex-col items-center rounded-[1.4rem] border bg-[#0d1a32]/90 px-1 py-3 text-center transition-colors hover:border-cyan-300/60 focus-visible:outline-2 focus-visible:outline-cyan-300 ' + (selected ? 'border-cyan-300/70 shadow-[0_0_24px_rgba(0,223,255,.18)]' : 'border-cyan-300/15 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]')}>
    <div className="relative h-24 w-24 max-w-full sm:h-28 sm:w-28">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
          style={{ filter: `drop-shadow(0 0 5px ${color}66)`, transition: 'stroke-dashoffset 500ms ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xl font-black tracking-wide" style={{ color }} aria-hidden="true">{label}</div>
    </div>
    <strong className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-200 sm:text-xs">{english}</strong>
    <span className="mt-0.5 text-xs font-semibold" style={{ color }}>{days} / 7 天</span>
  </button>
}

export default function CapsuleDashboard({ records, selectedType, onSelectType }: { records: LifeRecord[]; selectedType: LifeRecordType | null; onSelectType: (type: LifeRecordType | null) => void }) {
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    return localDate(date)
  })
  const recent = records.filter(record => dates.includes(record.date))
  const summary = summarizeLifeRecords(recent)
  const learningAmounts = Object.entries(summary.learningQuantities).map(([unit, quantity]) => `${quantity} ${unit}`)
  const rings: { type: LifeRecordType; label: string; english: string; color: string }[] = [
    { type: 'exercise', label: '运动', english: 'Exercise', color: '#35f2ce' },
    { type: 'sleep', label: '睡眠', english: 'Sleep', color: '#a58cff' },
    { type: 'learning', label: '学习', english: 'Study', color: '#61b9ff' },
    { type: 'meal', label: '饮食', english: 'Food', color: '#a7ef89' },
    { type: 'expense', label: '消费', english: 'Bill', color: '#ffb46a' },
    { type: 'mood', label: '心情', english: 'Emotion', color: '#ff79bc' },
  ]
  const details = [
    { label: '运动', english: 'Exercise', value: `${summary.exerciseCount} 次`, detail: `记录时长 ${summary.exerciseMinutes} 分钟`, color: '#35f2ce' },
    { label: '睡眠', english: 'Sleep', value: `${Math.round(summary.sleepHours * 10) / 10} 小时`, detail: '近 7 天总时长', color: '#a58cff' },
    { label: '学习', english: 'Study', value: `${summary.learningCount} 次`, detail: [`${summary.learningMinutes} 分钟`, ...learningAmounts].join(' · '), color: '#61b9ff' },
    { label: '饮食', english: 'Food', value: `${summary.mealCount} 次`, detail: '已保存的饮食记录', color: '#a7ef89' },
    { label: '消费', english: 'Bill', value: `¥${summary.expenseAmount.toFixed(2)}`, detail: '近 7 天总支出', color: '#ffb46a' },
    {
      label: '心情',
      english: 'Emotion',
      value: summary.moodAverage === null
        ? (summary.moodCount ? `${summary.moodCount} 条 · 未评分` : '暂无')
        : `${summary.moodAverage.toFixed(1)} / 5`,
      detail: summary.ratedMoodCount
        ? `${summary.moodCount} 条描述，其中 ${summary.ratedMoodCount} 条有评分`
        : '未评分描述仍计入心情记录，但不参与平均分',
      color: '#ff79bc',
    },
  ]

  return <div className="space-y-6 pb-4">
    <div className="relative overflow-hidden rounded-[1.8rem] border border-cyan-300/25 bg-gradient-to-br from-[#102b45] via-[#111a39] to-[#29183f] px-5 py-6 shadow-[0_12px_55px_rgba(0,223,255,.10)]">
      <div className="pointer-events-none absolute right-6 top-0 h-32 w-32 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-28 h-32 w-32 rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="relative">
        <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-300">LIFE DATABASE / OVERVIEW</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">从记录里看见成长</h2>
        <p className="mt-2 text-sm text-slate-300">圆环显示近 7 天有记录的天数；点一个类别，查看该类全部历史，回看自己的变化。</p>
        <button type="button" onClick={() => onSelectType(null)} className="mt-4 inline-flex rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-300/20">总记录 {records.length} 条 · 查看全部 ↓</button>
      </div>
    </div>

    <section aria-labelledby="coverage-heading" className="space-y-3">
      <div><h3 id="coverage-heading" className="text-lg font-bold">近 7 天记录进度</h3><p className="mt-1 text-xs text-muted">点圆环查看分类历史。圆环表示记录覆盖，不表示健康或消费目标。</p></div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
        {rings.map(ring => <RecordRing key={ring.type} {...ring} days={countRecordedDays(recent, ring.type, dates)} onClick={() => onSelectType(ring.type)} selected={selectedType === ring.type} />)}
      </div>
    </section>

    <section aria-labelledby="numbers-heading" className="space-y-3">
      <div><h3 id="numbers-heading" className="text-lg font-bold">记录里的数字</h3><p className="mt-1 text-xs text-muted">直接根据已确认并保存的记录计算</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {details.map(item => <div key={item.label} className="rounded-2xl border border-cyan-300/15 bg-[#0d1a32]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]">
          <div className="flex items-center gap-2 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}<span className="font-mono text-[10px]">{item.english}</span></div>
          <div className="mt-3 text-xl font-black tabular-nums sm:text-2xl" style={{ color: item.color }}>{item.value}</div>
          <div className="mt-1 text-[11px] leading-4 text-muted">{item.detail}</div>
        </div>)}
      </div>
    </section>
    {records.length === 0 && <p className="card text-center text-sm text-muted">还没有已保存的记录。去「记录」输入一句话，确认后就能看到圆环和数字。</p>}
  </div>
}
