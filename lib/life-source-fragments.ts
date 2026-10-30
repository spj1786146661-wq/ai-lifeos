import type { LifeRecordDraft, LifeRecordType } from './life-records.ts'

export interface LifeSourceSpan {
  start: number
  end: number
  text: string
}

export interface SourceSentence extends LifeSourceSpan {
  index: number
}

const SENTENCE_BREAKS = /[，。；！？,;!?\n]+/g

/**
 * Split the original message into non-empty, independently selectable fragments.
 * Offsets refer to the untouched original string so punctuation and repeated text
 * remain unambiguous.
 */
export function splitSourceSentences(text: string): SourceSentence[] {
  const fragments: SourceSentence[] = []
  let start = 0
  for (const match of text.matchAll(SENTENCE_BREAKS)) {
    const end = match.index ?? start
    pushTrimmed(text, start, end, fragments)
    start = end + match[0].length
  }
  pushTrimmed(text, start, text.length, fragments)
  return fragments
}

function pushTrimmed(text: string, rawStart: number, rawEnd: number, fragments: SourceSentence[]) {
  let start = rawStart
  let end = rawEnd
  while (start < end && /\s/.test(text[start])) start += 1
  while (end > start && /\s/.test(text[end - 1])) end -= 1
  if (end <= start) return
  fragments.push({ index: fragments.length, start, end, text: text.slice(start, end) })
}

/** Choose the smallest sentence that contains a known fact from the parsed record. */
export function locateDraftInSource(text: string, draft: LifeRecordDraft): LifeSourceSpan | null {
  const needles = factNeedles(draft)
  for (const sentence of splitSourceSentences(text)) {
    if (needles.some(needle => sentence.text.includes(needle))) {
      return { start: sentence.start, end: sentence.end, text: sentence.text }
    }
  }
  return null
}

function factNeedles(draft: LifeRecordDraft): string[] {
  const candidates = [
    draft.activity,
    draft.food,
    draft.subject,
    draft.note,
    draft.amount === undefined ? undefined : `${draft.amount}元`,
    draft.hours === undefined ? undefined : `${draft.hours}小时`,
    draft.durationMinutes === undefined ? undefined : `${draft.durationMinutes}分钟`,
  ]
  const needles = candidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const typeHints: Record<LifeRecordType, string[]> = {
    exercise: ['运动', '训练', '跑', '卧推', '深蹲', '健身', '游泳', '骑车', '瑜伽'],
    sleep: ['睡', '睡眠'],
    learning: ['学习', '看书', '阅读', '复习', '背单词', '题', '页'],
    meal: ['吃', '喝', '餐', '饭', '面', '水果', '咖啡'],
    expense: ['花', '消费', '支出', '买', '¥', '￥', '元'],
    mood: ['心情', '开心', '高兴', '平静', '焦虑', '难过', '低落'],
  }
  return [...needles, ...typeHints[draft.type]]
}

export function spanFromOffsets(text: string, start: number, end: number): LifeSourceSpan | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null
  const raw = text.slice(start, end)
  const fragment = raw.trim()
  if (!fragment) return null
  const leftTrim = raw.length - raw.trimStart().length
  return { start: start + leftTrim, end: start + leftTrim + fragment.length, text: fragment }
}
