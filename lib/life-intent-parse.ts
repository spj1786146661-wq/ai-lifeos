import {
  LIFE_RECORD_TYPES,
  normalizeLifeRecord,
  type LifeRecordDraft,
  type LifeRecordType,
} from './life-records.ts'
import { splitSourceSentences, type LifeSourceSpan } from './life-source-fragments.ts'

/**
 * Multi-intent parsing shared by the rule parser and any future AI parser.
 *
 * Both paths emit `LifeRecordCandidate`: a draft plus the original-text span it
 * came from. The review UI only ever sees this shape, so replacing the parser
 * does not change what the user has to confirm.
 */
export interface LifeRecordCandidate {
  draft: LifeRecordDraft
  /** Offsets into the untouched original message. */
  span: LifeSourceSpan
  /** True when a field the record needs is still missing. */
  needsFields: boolean
  /** Shown next to the candidate so the user knows what to fill in. */
  missingReason?: string
}

export interface ParseOptions {
  /** Stable per message; lets a sourceRef survive a refresh. */
  messageId: string
  date: string
}

/** 中文或阿拉伯数字，例如「两个」「7」「半」。 */
const CN_WHOLE_NUM = '(?:[0-9]+(?:\.[0-9]+)?|一|两|二|三|四|五|六|七|八|九|十)'
const CN_NUM = '(?:' + CN_WHOLE_NUM + '|半)'
/** 时长还允许「7个半」「七个半」这类自然表达。 */
const CN_DURATION_NUM = '(?:' + CN_WHOLE_NUM + '(?:个半)?|半)'

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function cnNumber(value: string): number {
  if (value.endsWith('个半')) return cnNumber(value.slice(0, -2)) + 0.5
  if (/^[0-9]/.test(value)) return Number(value)
  if (value === '两') return 2
  if (value === '半') return 0.5
  if (value === '十') return 10
  if (value.length === 1) return CN_DIGITS[value] ?? 0
  if (value.startsWith('十')) return 10 + (CN_DIGITS[value[1]] ?? 0)
  if (value.endsWith('十')) return (CN_DIGITS[value[0]] ?? 0) * 10
  return (CN_DIGITS[value[0]] ?? 0) * 10 + (CN_DIGITS[value[1]] ?? 0)
}

function isHourUnit(unit: string): boolean {
  return unit === '小时' || unit === '钟头' || /^h$/i.test(unit)
}

function toMinutes(value: number, unit: string): number {
  return isHourUnit(unit) ? value * 60 : value
}

/** 金额子句，例如「花了28块」「28元」。用于把花费从食物描述中分离。 */
const MONEY_SPLIT = /(?:^|[了的和与及，。；,;])\s*(?:花了?|花掉|消费了?|支出|买了?|付了?)?\s*\d+(?:\.\d+)?\s*(?:元|块|块钱)/

function spanOf(sentences: readonly LifeSourceSpan[], start: number, end: number): LifeSourceSpan | null {
  const containing = sentences.find(sentence => sentence.start <= start && end <= sentence.end)
  if (containing) return { start: containing.start, end: containing.end, text: containing.text }
  return null
}

function pushCandidate(
  list: LifeRecordCandidate[],
  seen: Set<string>,
  value: unknown,
  date: string,
  span: LifeSourceSpan | null,
  needsFields = false,
  missingReason?: string,
) {
  // A candidate that still needs fields must not be silently dropped when
  // normalizeLifeRecord rejects it, otherwise the user loses the hint.
  let draft: LifeRecordDraft
  try { draft = normalizeLifeRecord(value, date) } catch {
    if (!needsFields) return
    const raw = value as LifeRecordDraft
    // Keep the words the user actually said so an incomplete candidate can be
    // reviewed in place instead of being replaced by an empty placeholder.
    draft = { ...raw, type: raw.type, date, note: typeof raw.note === 'string' ? raw.note : '' }
  }
  if (!span) return
  const key = [draft.type, span.start, span.end, JSON.stringify(draft)].join('|')
  if (seen.has(key)) return
  seen.add(key)
  list.push({
    draft: { ...draft, ...(needsFields ? { needsFields: true } : {}), ...(missingReason ? { missingReason } : {}) },
    span,
    needsFields,
    ...(missingReason ? { missingReason } : {}),
  })
}

/**
 * Recover a strength-training fact split by a comma, for example
 * 「卧推60公斤，做了4组」. Keeping this as a narrow whole-message pass avoids
 * changing the selectable-fragment behavior used by every other category.
 */
function parseCrossFragmentStrength(text: string, options: ParseOptions): LifeRecordCandidate[] {
  const candidates: LifeRecordCandidate[] = []
  const pattern = /(卧推|深蹲|硬拉|划船|推举|弯举|飞鸟|臂屈伸|引体向上|下拉)\s*(\d+(?:\.\d+)?)\s*(?:公斤|千克|kg|KG)\s*[，,]\s*(?:做(?:了)?|共|一共)?\s*(\d+)\s*组/g
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start === undefined) continue
    const span = { start, end: start + match[0].length, text: match[0] }
    const draft = normalizeLifeRecord({
      type: 'exercise',
      date: options.date,
      note: '',
      activity: match[1],
      weightKg: Number(match[2]),
      sets: Number(match[3]),
      sourceRef: {
        messageId: options.messageId,
        ...span,
        origin: 'ai',
      },
    }, options.date)
    candidates.push({ draft, span, needsFields: false })
  }
  return candidates
}

/**
 * Parse a single fragment. One fragment may yield several categories, so the
 * caller can offer a meal and an expense from the same clause.
 */
export function parseFragmentCandidates(fragment: LifeSourceSpan, fullText: string, options: ParseOptions, siblings: readonly LifeRecordCandidate[] = []): LifeRecordCandidate[] {
  const { date, messageId } = options
  const found: LifeRecordCandidate[] = []
  const seen = new Set<string>()
  const sentences = splitSourceSentences(fullText)
  const span = spanOf(sentences, fragment.start, fragment.end)
  if (!span) return found
  const text = fragment.text

  // 睡眠：睡了/睡足/只睡 + 时长
  const sleep = new RegExp('(?:睡了|睡足|只睡|睡|睡眠)\\s*(' + CN_DURATION_NUM + ')\\s*(?:个)?\\s*(小时|钟头|分钟|分|h|H)').exec(text)
  if (sleep) {
    const hours = toMinutes(cnNumber(sleep[1]), sleep[2]) / 60
    pushCandidate(found, seen, { type: 'sleep', date, hours: Math.round(hours * 100) / 100, note: '' }, date, span)
  } else if (/(?:睡|睡眠|失眠|熬夜)/.test(text) && !/睡觉了|睡着|睡醒/.test(text)) {
    // 只提到睡眠、没有时长：给出待补充候选。
    pushCandidate(found, seen, { type: 'sleep', date, note: '' }, date, span, true, '请补充睡眠时长')
  }

  // 运动：力量数据（重量 + 组数）或有氧时长，任一出现即可
  const strength = /(卧推|深蹲|硬拉|划船|推举|弯举|飞鸟|臂屈伸|引体向上|下拉)\s*(\d+(?:\.\d+)?)\s*(?:公斤|千克|kg|KG)\s*(?:做(?:了)?|共|一共)?\s*(\d+)\s*组/.exec(text)
  // 「跑了半小时」「跑步半个小时」：活动词中间可能插入「了」。
  const cardio = new RegExp('(跑|散|走|健身|力量训练|游泳|骑|瑜伽|运动|训练|跳绳|椭圆机|划船机)(?:步|了步|步了|车|了车)?(?:了)?\\s*(?:个)?\\s*(' + CN_DURATION_NUM + ')\\s*(?:个)?\\s*(分钟|分|小时|钟头|h|H)').exec(text)
  // 「跑了5公里」「跑步5公里」：活动词中间可能插入「了」。
  const distance = new RegExp('(跑|散|走|游|骑|跳)(?:步|了步|了|步了)?\\s*(?:大概|大约|差不多)?\\s*(' + CN_NUM + ')\\s*(公里|千米|km|KM|米)').exec(text)
  if (strength) {
    pushCandidate(found, seen, {
      type: 'exercise', date, note: '', activity: strength[1], weightKg: Number(strength[2]), sets: Number(strength[3]),
    }, date, span)
  } else if (cardio) {
    const cardioName = cardio[1] === '跑' ? '跑步'
      : cardio[1] === '散' ? '散步'
      : cardio[1] === '走' ? '走路'
      : cardio[1] === '骑' ? '骑车'
      : cardio[1]
    pushCandidate(found, seen, {
      type: 'exercise', date, note: '', activity: cardioName,
      durationMinutes: Math.round(toMinutes(cnNumber(cardio[2]), cardio[3]) * 100) / 100,
    }, date, span)
  } else if (distance) {
    // 只说了距离：时长仍然未知，标记待补充而不是猜一个数字。
    const km = distance[3] === '米' ? cnNumber(distance[2]) / 1000 : cnNumber(distance[2])
    const activityName = distance[1] === '跑' ? '跑步'
      : distance[1] === '散' ? '散步'
      : distance[1] === '走' ? '走路'
      : distance[1] === '游' ? '游泳'
      : distance[1] === '骑' ? '骑车'
      : '跳绳'
    pushCandidate(found, seen, {
      type: 'exercise', date, note: '', activity: activityName,
    }, date, span, true, '请补充运动时长（已记录 ' + (Math.round(km * 100) / 100) + ' 公里，可写在备注里）')
  } else {
    // 只提到活动、没有时长或组数：仍然给出一条待补充候选，不丢弃整句话。
    // 同一消息里已经有完整训练数据时不再重复提示，避免把一件事拆成两条。
    const bareActivity = /(跑步|散步|走路|健身|力量训练|游泳|骑车|骑行|瑜伽|运动|训练|跳绳|椭圆机|划船机|卧推|深蹲|硬拉|划船|推举|弯举|飞鸟|臂屈伸|引体向上|下拉)/.exec(text)
    const alreadyHasWorkout = siblings.some(candidate => candidate.draft.type === 'exercise' && candidate.needsFields === false)
    if (bareActivity && !alreadyHasWorkout) {
      pushCandidate(found, seen, {
        type: 'exercise', date, note: '', activity: bareActivity[1],
      }, date, span, true, '请补充运动时长或训练组数')
    }
  }

  // 学习：先认「对象 + 时长」，再认「时长 + 对象」，都没有才提示补字段。
  const STUDY_VERB = '(学习|学|看书|阅读|复习|背单词|上课|听课|刷题|看)'
  const studySubjectFirst = new RegExp(STUDY_VERB + '(?:了|完|过)?\\s*([^，。；,;！？!?\\d]{1,20}?)\\s*(' + CN_DURATION_NUM + ')\\s*(?:个)?\\s*(小时|钟头|分钟|分|h|H)').exec(text)
  const studyTimeFirst = new RegExp(STUDY_VERB + '(?:了|完|过)?\\s*(?:一会儿|一下)?\\s*(' + CN_DURATION_NUM + ')\\s*(?:个)?\\s*(小时|钟头|分钟|分|h|H)\\s*([^，。；,;！？!?\\d]{0,10})').exec(text)
  const learnCount = /(?:做了?|完成了?|刷了?|背了?)\s*(\d+)\s*(道[^，。；,;]{0,18}?题|道题|题|页|个单词|篇)/.exec(text)
  const cleanSubject = (value: string) => value.replace(/^(?:了|的|在|一会儿|一下|个)+/, '').replace(/^(?:会儿|下)/, '').trim()
  // 「学了两个小时英语」里，subjectFirst 会把「了」误当成学习对象，此时交给 timeFirst。
  const subjectFirstSubject = studySubjectFirst ? cleanSubject(studySubjectFirst[2]) : ''
  if (studySubjectFirst && subjectFirstSubject) {
    const durationMinutes = Math.round(toMinutes(cnNumber(studySubjectFirst[3]), studySubjectFirst[4]) * 100) / 100
    pushCandidate(found, seen, { type: 'learning', date, note: '', subject: subjectFirstSubject, durationMinutes }, date, span)
  } else if (studyTimeFirst) {
    const trailing = cleanSubject(studyTimeFirst[4])
    const subject = trailing || studyTimeFirst[1]
    const durationMinutes = Math.round(toMinutes(cnNumber(studyTimeFirst[2]), studyTimeFirst[3]) * 100) / 100
    pushCandidate(found, seen, { type: 'learning', date, note: '', subject, durationMinutes }, date, span)
  } else if (learnCount) {
    const unit = /题/.test(learnCount[2]) ? '题' : learnCount[2]
    pushCandidate(found, seen, {
      type: 'learning', date, note: '', subject: '学习', quantity: Number(learnCount[1]), unit,
    }, date, span)
  } else {
    // 只提到学习动作、没有时长或数量：给出待补充候选。
    const bareStudy = /(?:学习|学|看|阅读|复习|背单词|上课|听课|刷题)(?:书|了书|完书)?(?:了|完|过)?\s*(?:一会儿|一下|下)?\s*([^，。；,;！？!?\d]{0,10})/.exec(text)
    const studySubject = bareStudy ? cleanSubject(bareStudy[1]) || (bareStudy[0].includes('书') ? '书' : '学习') : '学习'
    if (bareStudy && !text.includes('学校') && !text.includes('同学')) {
      pushCandidate(found, seen, {
        type: 'learning', date, note: '', subject: studySubject,
      }, date, span, true, '请补充学习时长或完成数量')
    }
  }

  // 饮食：吃了/喝了 + 食物；金额子句不属于食物
  const meal = /(?:吃|喝)了?\s*([^，。；,;！？!?]{1,60})/.exec(text)
  if (meal) {
    const raw = meal[1].trim()
    const food = raw.split(MONEY_SPLIT)[0].replace(/[了的和与及花买付]+$/, '').trim()
    if (food && !/^(?:什么|多少|吗|了)$/.test(food)) {
      pushCandidate(found, seen, { type: 'meal', date, note: '', food }, date, span)
    }
  }

  // 消费：花了/消费/支出/买了 + 金额。与饮食分开判断，同句可同时成立。
  const expense = /(?:花了|花掉|消费了?|支出|买了?|付了?)\s*[^\d¥￥]{0,12}[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块|块钱)?/.exec(text)
  const expenseLoose = /[¥￥]\s*(\d+(?:\.\d+)?)/.exec(text)
  if (expense || expenseLoose) {
    const amount = Number(expense?.[1] ?? expenseLoose?.[1])
    pushCandidate(found, seen, { type: 'expense', date, note: '', amount, currency: 'CNY' }, date, span)
  } else if (/(?:花了|花掉|消费了?|支出|买了?|付了?|花钱|消费|付款|结账)/.test(text)) {
    // 提到消费动作但没有金额：给出待补充候选，不猜测金额。
    pushCandidate(found, seen, { type: 'expense', date, note: '', currency: 'CNY' }, date, span, true, '请补充消费金额')
  }

  // 心情：保留用户说出的描述。「心情不错」本身已经是完整记录，不擅自换算成
  // 1–5 分；只有明确说出「心情3分」这类数值时才写 score。
  const explicitMoodScore = /(?:心情|情绪)\s*(?:是|为|打到?|给了?)?\s*([1-5])\s*分/.exec(text)
  const moodWord = /(心情(?:很差|不好|一般|不错|很好|超好|棒)|开心|高兴|平静|焦虑|难过|低落|烦躁|疲惫|累|充实|满足)/.exec(text)
  if (explicitMoodScore) {
    pushCandidate(found, seen, {
      type: 'mood', date, note: moodWord?.[0] ?? `心情${explicitMoodScore[1]}分`, score: Number(explicitMoodScore[1]),
    }, date, span)
  } else if (moodWord) {
    pushCandidate(found, seen, {
      type: 'mood', date, note: moodWord[0],
    }, date, span)
  }

  return found.map(candidate => ({
    ...candidate,
    draft: {
      ...candidate.draft,
      sourceRef: { messageId, ...candidate.span, origin: 'ai' as const },
    },
  }))
}

/**
 * Parse a whole message. Every fragment is examined on its own, so one
 * sentence can produce several categories and one message can produce several
 * sentences. Fragments that produce nothing are returned so the caller can
 * keep offering them for manual tagging.
 */
export function parseMessageCandidates(text: string, options: ParseOptions): {
  candidates: LifeRecordCandidate[]
  unmatched: LifeSourceSpan[]
} {
  const sentences = splitSourceSentences(text)
  const candidates: LifeRecordCandidate[] = parseCrossFragmentStrength(text, options)
  const unmatched: LifeSourceSpan[] = []
  for (const sentence of sentences) {
    const found = parseFragmentCandidates(sentence, text, options, candidates)
    const coveredByLinkedFact = candidates.some(candidate => (
      candidate.span.start < sentence.end && candidate.span.end > sentence.start
    ))
    if (found.length === 0 && !coveredByLinkedFact) unmatched.push(sentence)
    candidates.push(...found)
  }
  // 「早上去健身房练胸，卧推60公斤做了4组」describes one workout. Once a
  // complete workout exists, the bare mention must not become a second event.
  const ordered = [...candidates].sort((left, right) => left.span.start - right.span.start)
  const hasCompleteWorkout = ordered.some(candidate => candidate.draft.type === 'exercise' && !candidate.needsFields)
  const seenFacts = new Set<string>()
  const deduped = ordered.filter(candidate => {
    if (hasCompleteWorkout && candidate.draft.type === 'exercise' && candidate.needsFields) return false
    // Repeating the same fact inside one message is still one fact.
    const fact = { ...candidate.draft }
    delete fact.sourceRef
    const key = [candidate.draft.type, JSON.stringify(fact)].join('|')
    if (seenFacts.has(key)) return false
    seenFacts.add(key)
    return true
  })
  return { candidates: deduped, unmatched }
}

export const PARSEABLE_TYPES: readonly LifeRecordType[] = LIFE_RECORD_TYPES
