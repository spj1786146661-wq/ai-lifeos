'use client'

import Link from 'next/link'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import {
  MODEL_TEST_MAX_MESSAGE_CHARS,
  MODEL_TEST_MAX_MESSAGES,
  MODEL_TEST_MAX_OUTPUT_TOKENS,
  TOKENHUB_MODEL_LABEL,
  type ModelTestUsage,
} from '@/lib/tokenhub-model-test-shared'
import styles from './model-test.module.css'

const EXAMPLE =
  '今天跑步5公里，学习英语2小时，请识别这句话包含哪些生活记录。'

interface DisplayMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  usage?: ModelTestUsage | null
  model?: string
}

function usageText(usage: ModelTestUsage | null | undefined): string {
  if (!usage) return '本次响应未返回 usage'
  const value = (tokens: number | null) => tokens === null ? '未提供' : String(tokens)
  return `输入 ${value(usage.inputTokens)} · 输出 ${value(usage.outputTokens)} · 总计 ${value(usage.totalTokens)} Tokens`
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    if (typeof record.error === 'string' && record.error.trim()) {
      const code = typeof record.code === 'string' ? ` (${record.code})` : ''
      const requestId =
        typeof record.requestId === 'string' ? ` · 请求 ID ${record.requestId}` : ''
      return `${record.error}${code}${requestId}`
    }
  }
  return `请求失败（HTTP ${status}）。`
}

export default function ModelTestPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUsage, setLastUsage] = useState<ModelTestUsage | null>(null)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, loading, error])

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    if (text.length > MODEL_TEST_MAX_MESSAGE_CHARS) {
      setError(`单条消息最多 ${MODEL_TEST_MAX_MESSAGE_CHARS} 个字符。`)
      return
    }

    const userMessage: DisplayMessage = {
      id: nextId.current++,
      role: 'user',
      content: text,
    }
    const outgoing = [...messages, userMessage]
      .filter(message => !message.content.startsWith('（请求失败'))
      .map(({ role, content }) => ({ role, content }))

    setMessages(current => [...current, userMessage])
    setInput('')
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/model-test/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing }),
      })
      const payload = await response.json().catch(() => null) as unknown
      if (!response.ok) {
        setError(errorMessage(payload, response.status))
        return
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        setError('模型响应格式无效。')
        return
      }
      const record = payload as Record<string, unknown>
      if (typeof record.content !== 'string' || !record.content.trim()) {
        setError('模型没有返回可显示的文本。')
        return
      }
      const usage =
        record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
          ? record.usage as ModelTestUsage
          : null
      setLastUsage(usage)
      setMessages(current => [...current, {
        id: nextId.current++,
        role: 'assistant',
        content: record.content as string,
        usage,
        model: typeof record.model === 'string' ? record.model : TOKENHUB_MODEL_LABEL,
      }])
    } catch {
      setError('网络请求失败，请确认电脑服务仍在运行。')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const assistantCount = messages.filter(message => message.role === 'assistant').length

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>AI / TOKENHUB TEST</p>
            <h1 className={styles.title}>{TOKENHUB_MODEL_LABEL}</h1>
            <p className={styles.subtitle}>腾讯云 TokenHub · OpenAI 兼容 Chat Completions</p>
          </div>
          <Link className={styles.back} href="/">返回主页</Link>
        </header>

        <div className={styles.notice}>
          测试专用：对话只保留在当前页面内存中，不自动保存生活记录，也不会写入正式数据库。
        </div>

        <section className={styles.chat} aria-label="模型测试对话">
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <div>
                <strong>手机模型连通性测试</strong>
                输入一句话，验证 TokenHub 的真实回复、错误提示与 Token 用量。
              </div>
            </div>
          ) : (
            <ol className={styles.messageList}>
              {messages.map(message => (
                <li
                  className={`${styles.message} ${message.role === 'user' ? styles.userMessage : ''}`}
                  key={message.id}
                >
                  <span className={styles.label}>
                    {message.role === 'user' ? '你' : message.model ?? TOKENHUB_MODEL_LABEL}
                  </span>
                  <div className={styles.bubble}>{message.content}</div>
                  {message.role === 'assistant' && (
                    <span className={styles.usage}>{usageText(message.usage)}</span>
                  )}
                </li>
              ))}
              {loading && (
                <li className={styles.message}>
                  <span className={styles.label}>{TOKENHUB_MODEL_LABEL}</span>
                  <div className={styles.bubble}>
                    <span className={styles.typing} aria-label="模型正在回复">
                      <span /><span /><span />
                    </span>
                  </div>
                </li>
              )}
            </ol>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div ref={endRef} />
        </section>

        <form className={styles.composer} onSubmit={sendMessage}>
          <button
            className={styles.example}
            type="button"
            onClick={() => setInput(EXAMPLE)}
          >
            示例：{EXAMPLE}
          </button>
          <div className={styles.inputRow}>
            <textarea
              className={styles.input}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MODEL_TEST_MAX_MESSAGE_CHARS}
              rows={1}
              placeholder="输入测试消息…"
              aria-label="测试消息"
            />
            <button className={styles.send} type="submit" disabled={loading || !input.trim()}>
              {loading ? '等待中' : '发送'}
            </button>
          </div>
          <p className={styles.hint}>
            单次最多 {MODEL_TEST_MAX_MESSAGE_CHARS} 字符、{MODEL_TEST_MAX_OUTPUT_TOKENS} 输出 Tokens；每页最多 {MODEL_TEST_MAX_MESSAGES} 条消息。Enter 发送，Shift+Enter 换行。
          </p>
          <div className={styles.meta}>
            <span>回复次数：{assistantCount}</span>
            <span>本机限流：8 次 / 分钟</span>
            {lastUsage && <span>{usageText(lastUsage)}</span>}
          </div>
        </form>
      </div>
    </main>
  )
}
