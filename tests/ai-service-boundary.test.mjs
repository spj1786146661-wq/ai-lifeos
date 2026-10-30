/**
 * AI 服务边界保护测试
 *
 * 目的：AI-LifeOS 网页版是基于 AGPL-3.0 项目 LifeTracker 的衍生作品。
 * `lib/ai/chatgpt-plan-*.ts` 与 `lib/ai/local-request-security.ts` 目前是该衍生
 * 应用中相对独立的一块能力，未来有可能被单独部署成闭源 AI 服务。
 *
 * 本测试不判定法律意义上的作品独立性。它只保证一件工程事实：
 * 这五个受保护模块的可解析本地依赖闭包，不会悄悄扩大到 AGPL 业务代码里。
 *
 * 检测盲区见 docs/AI_SERVICE_BOUNDARY.md，覆盖率不等于 100%。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AI_DIR = join(REPO_ROOT, 'lib', 'ai')

/** 受保护模块：允许互相依赖，闭包不得越界。 */
const PROTECTED_MODULES = [
  'chatgpt-plan-credentials.ts',
  'chatgpt-plan-oauth.ts',
  'chatgpt-plan-provider.ts',
  'chatgpt-plan-responses.ts',
  'local-request-security.ts',
]

/** 允许使用的独立第三方包。新增条目必须先评估许可证与独立性影响。 */
const ALLOWED_PACKAGES = new Set(['openai'])

/** 允许使用的 Node.js 内置模块。 */
const ALLOWED_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http',
  'https', 'net', 'os', 'path', 'process', 'stream', 'string_decoder',
  'timers', 'tls', 'url', 'util', 'zlib',
])

/** 明确禁止的应用内部耦合信号。 */
const FORBIDDEN_PATTERNS = [
  { label: 'AGPL 业务模块 life-*', test: spec => /(^|\/)life-[a-z0-9-]+(\.tsx?)?$/.test(spec) },
  { label: 'Next.js 运行时 next/*', test: spec => spec.startsWith('next/') || spec === 'next' },
  { label: 'React 运行时', test: spec => spec === 'react' || spec === 'react-dom' },
  { label: '应用内部路径别名 @/', test: spec => spec.startsWith('@/') },
  { label: 'Firebase 运行时', test: spec => spec.startsWith('firebase') },
  { label: '存储适配层', test: spec => /(^|\/)(storage-adapter|indexeddb-adapter)$/.test(spec) },
]

/* ------------------------------------------------------------------ */
/* 源码解析                                                            */
/* ------------------------------------------------------------------ */

const RE_SIDE_EFFECT = /^\s*import\s*(['"])([^'"]+)\1\s*;?\s*$/
const RE_SINGLE_LINE = /^\s*(?:import|export)\b[^\n]*?\bfrom\s*(['"])([^'"]+)\1/
const RE_MULTILINE_OPEN = /^\s*(?:import|export)\s*(?:type\s*)?(?:\{|\*\s*as\b|\*\s*$)/
const RE_FROM_ONLY = /\bfrom\s*(['"])([^'"]+)\1/
const RE_REQUIRE = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g
const RE_DYNAMIC_STATIC = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g
const RE_DYNAMIC_BLIND = /\b(?:import|require)\s*\(\s*(?!['"\s])/g

/**
 * 从源码文本中提取模块说明符。
 * 返回 { specifiers, blindSpots }：blindSpots 记录无法静态解析的动态引用数量。
 */
export function extractSpecifiers(source) {
  const specifiers = []
  const lines = source.split(/\r?\n/)
  let inMultiline = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue
    }

    if (inMultiline) {
      const m = line.match(RE_FROM_ONLY)
      if (m) {
        specifiers.push(m[2])
        inMultiline = false
      }
      continue
    }

    const side = line.match(RE_SIDE_EFFECT)
    if (side) {
      specifiers.push(side[2])
      continue
    }

    const single = line.match(RE_SINGLE_LINE)
    if (single) {
      specifiers.push(single[2])
      continue
    }

    if (RE_MULTILINE_OPEN.test(line)) {
      const inlineFrom = line.match(RE_FROM_ONLY)
      if (inlineFrom) {
        specifiers.push(inlineFrom[2])
      } else {
        inMultiline = true
      }
    }
  }

  for (const re of [RE_REQUIRE, RE_DYNAMIC_STATIC]) {
    const r = new RegExp(re.source, re.flags)
    let m
    while ((m = r.exec(source)) !== null) specifiers.push(m[2])
  }

  const blindSpots = (source.match(new RegExp(RE_DYNAMIC_BLIND.source, 'g')) ?? []).length

  return { specifiers: [...new Set(specifiers)], blindSpots }
}

/** 把说明符归类为 builtin / package / local。 */
export function classifySpecifier(spec) {
  if (spec.startsWith('node:')) return 'builtin'
  if (spec.startsWith('.') || spec.startsWith('/')) return 'local'
  if (spec.startsWith('@/')) return 'alias'
  if (ALLOWED_BUILTINS.has(spec)) return 'builtin'
  return 'package'
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']

/** 把本地说明符解析为磁盘路径，失败返回 null。 */
export function resolveLocalSpecifier(fromFile, spec) {
  const base = spec.startsWith('@/')
    ? resolve(REPO_ROOT, spec.slice(2))
    : resolve(dirname(fromFile), spec)

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function rel(absPath) {
  return relative(REPO_ROOT, absPath).split(sep).join('/')
}

/**
 * 构建从入口模块出发的依赖闭包。
 * 不依赖真实文件系统即可测试：可通过 readSource 注入内存源码。
 */
export function buildClosure(entryFiles, readSource = p => readFileSync(p, 'utf8')) {
  const localFiles = new Set()
  const packages = new Set()
  const builtins = new Set()
  const violations = []
  const blindSpots = []
  const edges = []
  const queue = [...entryFiles]

  while (queue.length > 0) {
    const file = queue.shift()
    if (localFiles.has(file)) continue
    localFiles.add(file)

    const { specifiers, blindSpots: blindCount } = extractSpecifiers(readSource(file))
    if (blindCount > 0) blindSpots.push({ file: rel(file), count: blindCount })

    for (const spec of specifiers) {
      edges.push({ from: rel(file), spec })
      const kind = classifySpecifier(spec)

      if (kind === 'builtin') {
        builtins.add(spec.replace(/^node:/, ''))
        continue
      }

      if (kind === 'package') {
        if (!ALLOWED_PACKAGES.has(spec)) {
          violations.push({ file: rel(file), spec, reason: '未获准的第三方包' })
        }
        packages.add(spec)
        continue
      }

      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.test(spec)) {
          violations.push({ file: rel(file), spec, reason: rule.label })
        }
      }

      const resolved = resolveLocalSpecifier(file, spec)
      if (!resolved) {
        violations.push({ file: rel(file), spec, reason: '无法解析的本地模块' })
        continue
      }
      const relResolved = rel(resolved)
      const insideAi = relResolved.startsWith('lib/ai/')
      const isProtected = insideAi && PROTECTED_MODULES.includes(relResolved.slice('lib/ai/'.length))
      if (!isProtected) {
        violations.push({ file: rel(file), spec, reason: `依赖越界 -> ${relResolved}` })
      }
      queue.push(resolved)
    }
  }

  return { localFiles: [...localFiles].map(rel).sort(), packages: [...packages].sort(), builtins: [...builtins].sort(), violations, blindSpots, edges }
}

/* ------------------------------------------------------------------ */
/* 真实工程检查                                                        */
/* ------------------------------------------------------------------ */

const entryFiles = PROTECTED_MODULES.map(name => join(AI_DIR, name))

test('受保护的 AI 模块全部存在', () => {
  for (const file of entryFiles) {
    assert.ok(existsSync(file), `缺少受保护模块: ${rel(file)}`)
  }
})

test('本地传递依赖闭包严格等于五个受保护模块', () => {
  const { localFiles } = buildClosure(entryFiles)
  const expected = PROTECTED_MODULES.map(name => `lib/ai/${name}`).sort()
  assert.deepEqual(localFiles, expected,
    '受保护模块的本地依赖闭包发生了变化。新增跨目录依赖会削弱未来独立部署的可能性。')
})

test('没有任何越界依赖或未获准的第三方包', () => {
  const { violations } = buildClosure(entryFiles)
  assert.deepEqual(violations, [], `发现越界依赖: ${JSON.stringify(violations, null, 2)}`)
})

test('不直接或间接依赖 AGPL 来源的 life-* 业务模块', () => {
  const { edges, localFiles } = buildClosure(entryFiles)
  const lifeSpecs = edges.filter(e => /(^|\/)life-[a-z0-9-]+(\.tsx?)?$/.test(e.spec))
  assert.deepEqual(lifeSpecs, [], '禁止引用 life-* 业务模块')
  const lifeFiles = localFiles.filter(f => /(^|\/)life-[a-z0-9-]+\.tsx?$/.test(f))
  assert.deepEqual(lifeFiles, [], '禁止引入 life-* 业务文件')
})

test('不共享 LifeRecord 等应用内部类型定义', () => {
  for (const file of entryFiles) {
    const source = readFileSync(file, 'utf8')
    assert.ok(!/\bLifeRecord\b/.test(source),
      `${rel(file)} 引用了 LifeRecord 内部类型，破坏独立性边界`)
    assert.ok(!/\blife-records\b/.test(source),
      `${rel(file)} 引用了 life-records，破坏独立性边界`)
  }
})

test('不依赖 Next.js 页面、路由或中间件运行环境', () => {
  const { edges } = buildClosure(entryFiles)
  const nextSpecs = edges.filter(e => e.spec === 'next' || e.spec.startsWith('next/'))
  assert.deepEqual(nextSpecs, [], '受保护模块不得依赖 Next.js 运行时')
})

test('不使用路径别名、动态 import 或 require 绕开静态检查', () => {
  const { edges, blindSpots } = buildClosure(entryFiles)
  const aliasSpecs = edges.filter(e => e.spec.startsWith('@/'))
  assert.deepEqual(aliasSpecs, [], '受保护模块不得使用 @/ 路径别名')

  const requireSpecs = edges.filter(e => e.spec.startsWith('node:') === false && classifySpecifier(e.spec) === 'local' && e.spec.endsWith('.cjs'))
  assert.deepEqual(requireSpecs, [], '不应通过 require 引入额外本地模块')

  assert.deepEqual(blindSpots, [], `存在无法静态解析的动态引用: ${JSON.stringify(blindSpots)}`)
})

test('外部依赖仅限 Node.js 标准库与获准的独立 SDK', () => {
  const { packages, builtins } = buildClosure(entryFiles)
  // 五个受保护模块当前不引用任何第三方包，openai SDK 仅出现在未受保护的 client.ts。
  assert.deepEqual(packages, [], '受保护模块不应引入第三方包；如需引入须先更新白名单并复核独立性')
  for (const name of builtins) {
    assert.ok(ALLOWED_BUILTINS.has(name), `未登记的 Node.js 内置模块: ${name}`)
  }
})

/* ------------------------------------------------------------------ */
/* 检测器自检：证明违规时测试确实会失败                                */
/* ------------------------------------------------------------------ */

test('自检：检测器能识别越界的 life-* 依赖', () => {
  const fakeFile = join(AI_DIR, 'chatgpt-plan-boundary-fixture.ts')
  const sources = new Map([
    [fakeFile, `import { normalizeLifeRecord } from '../life-records.ts'\nexport const x = 1\n`],
    [join(REPO_ROOT, 'lib', 'life-records.ts'), `export function normalizeLifeRecord() { return null }\n`],
  ])
  const result = buildClosure([fakeFile], p => {
    const s = sources.get(p)
    if (s === undefined) throw new Error(`unexpected read: ${p}`)
    return s
  })
  assert.equal(result.violations.length > 0, true, '越界依赖必须被检出')
  assert.ok(result.violations.some(v => v.reason.includes('life-')), '违规原因应指明 life-* 业务模块')
})

test('自检：多行 import 与 export-from 同样被解析', () => {
  const fakeFile = join(AI_DIR, 'multi.ts')
  const sources = new Map([
    [fakeFile, `import {\n  a,\n  b,\n} from '../life-calendar.ts'\nexport { c } from '../life-search.ts'\n`],
    [join(REPO_ROOT, 'lib', 'life-calendar.ts'), `export const a = 1\n`],
    [join(REPO_ROOT, 'lib', 'life-search.ts'), `export const c = 1\n`],
  ])
  const result = buildClosure([fakeFile], p => sources.get(p))
  assert.ok(result.violations.length >= 2, '多行 import 与 export-from 都必须被检出')
})

test('自检：合法的 Node 内置模块与 openai SDK 不被误伤', () => {
  const fakeFile = join(AI_DIR, 'clean.ts')
  const sources = new Map([
    [fakeFile, `import { randomBytes } from 'node:crypto'\nimport OpenAI from 'openai'\nexport const ok = [randomBytes, OpenAI]\n`],
  ])
  const result = buildClosure([fakeFile], p => sources.get(p))
  assert.deepEqual(result.violations, [], '合法依赖不应报错')
  assert.deepEqual(result.packages, ['openai'])
  assert.deepEqual(result.builtins, ['crypto'])
})

test('自检：无法静态解析的动态 import 被记录为盲区而非静默放过', () => {
  const fakeFile = join(AI_DIR, 'dynamic.ts')
  const sources = new Map([
    [fakeFile, `const name = 'x'\nexport async function load() { return import(name) }\n`],
  ])
  const result = buildClosure([fakeFile], p => sources.get(p))
  assert.equal(result.blindSpots.length, 1, '动态 import 必须被记为检测盲区')
  assert.equal(result.blindSpots[0].count, 1)
})

test('自检：未获准的第三方包被拒绝', () => {
  const fakeFile = join(AI_DIR, 'pkg.ts')
  const sources = new Map([
    [fakeFile, `import x from 'some-unvetted-sdk'\nexport const y = x\n`],
  ])
  const result = buildClosure([fakeFile], p => sources.get(p))
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].reason, '未获准的第三方包')
})
