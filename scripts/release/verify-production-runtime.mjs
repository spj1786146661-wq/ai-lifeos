#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const START_TIMEOUT_MS = 45_000
const STOP_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 250
const copiedEntries = [
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'public',
]
const sensitiveEnvironmentPattern =
  /(?:API_KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|PRIVATE_KEY|SERVICE_ACCOUNT)/i

function productionEnvironment() {
  const env = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !sensitiveEnvironmentPattern.test(name)) {
      env[name] = value
    }
  }
  return {
    ...env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    AIOS_PUBLIC_BETA_HOSTS: '',
    AIOS_PUBLIC_TEST_HOSTS: '',
    AIOS_PERSONAL_ALPHA_BYOK: '0',
    AIOS_PERSONAL_ALPHA_BYOK_HOST: '',
  }
}

function npmInvocation(args) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args }
  }
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  const npmCli = npmCliCandidates.find(candidate => fs.existsSync(candidate))
  if (!npmCli) {
    throw new Error('Could not locate npm-cli.js beside the active Windows Node.js runtime.')
  }
  return {
    command: process.execPath,
    args: [npmCli, ...args],
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(
        `${command} exited with ${code ?? `signal ${signal ?? 'unknown'}`}`,
      ))
    })
  })
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => {
        if (error) reject(error)
        else if (!port) reject(new Error('Could not reserve a local port.'))
        else resolve(port)
      })
    })
  })
}

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/privacy',
      timeout: 2_000,
    }, response => {
      response.resume()
      if (response.statusCode === 200) resolve()
      else reject(new Error(`Health request returned HTTP ${response.statusCode}.`))
    })
    request.once('timeout', () => request.destroy(new Error('Health request timed out.')))
    request.once('error', reject)
  })
}

async function waitForHealth(child, port, output) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Next.js stopped before health verification.\n${output.value.trim()}`,
      )
    }
    try {
      await requestHealth(port)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
  throw new Error(
    `Next.js did not answer HTTP 200 within ${START_TIMEOUT_MS}ms.\n${output.value.trim()}`,
  )
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, STOP_TIMEOUT_MS)),
  ])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
  }
}

async function main() {
  const sourceRoot = process.cwd()
  const sourceBuildDirectory = process.env.AIOS_VERIFY_BUILD_DIR?.trim() || '.next'
  if (
    path.isAbsolute(sourceBuildDirectory)
    || sourceBuildDirectory === '.'
    || sourceBuildDirectory === '..'
    || sourceBuildDirectory.includes('/')
    || sourceBuildDirectory.includes('\\')
  ) {
    throw new Error('AIOS_VERIFY_BUILD_DIR must be one directory inside the project root.')
  }
  for (const required of [
    'package.json',
    'package-lock.json',
    'next.config.mjs',
    `${sourceBuildDirectory}/BUILD_ID`,
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, required))) {
      throw new Error(`Production runtime verification is missing ${required}.`)
    }
  }
  if (fs.existsSync(path.join(sourceRoot, 'next.config.ts'))) {
    throw new Error('next.config.ts would require TypeScript in the production runtime.')
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-production-runtime-'))
  let child = null
  try {
    for (const entry of copiedEntries) {
      const source = path.join(sourceRoot, entry)
      if (!fs.existsSync(source)) continue
      fs.cpSync(source, path.join(tempRoot, entry), {
        recursive: true,
        dereference: true,
        filter: input => !input.includes(`${path.sep}.next${path.sep}cache`),
      })
    }
    const sourceBuildRoot = path.join(sourceRoot, sourceBuildDirectory)
    fs.cpSync(sourceBuildRoot, path.join(tempRoot, '.next'), {
      recursive: true,
      dereference: true,
      filter: input => {
        const relative = path.relative(sourceBuildRoot, input).replaceAll('\\', '/')
        return relative !== 'cache' && !relative.startsWith('cache/')
      },
    })

    const env = productionEnvironment()
    const npm = npmInvocation(['ci', '--omit=dev', '--no-audit', '--no-fund'])
    await run(npm.command, npm.args, {
      cwd: tempRoot,
      env,
    })

    if (fs.existsSync(path.join(tempRoot, 'node_modules', 'typescript'))) {
      throw new Error('TypeScript must not be installed in the production-only runtime.')
    }

    const nextCli = path.join(tempRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
    if (!fs.existsSync(nextCli)) {
      throw new Error('Production-only install did not provide the Next.js CLI.')
    }
    const port = await reservePort()
    const output = { value: '' }
    child = spawn(process.execPath, [
      nextCli,
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ], {
      cwd: tempRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const capture = chunk => {
      output.value = `${output.value}${chunk.toString('utf8')}`.slice(-12_000)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    await waitForHealth(child, port, output)
    process.stdout.write(
      `Production-only runtime verified on 127.0.0.1:${port}; TypeScript is absent.\n`,
    )
  } finally {
    if (child) await stopChild(child)
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
