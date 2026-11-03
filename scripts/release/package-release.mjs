#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  auditTagSource,
  validateReleaseTag,
  validateSourceUrl,
} from './check-release-source.mjs'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function copyBuildOutput(sourceRoot, targetRoot) {
  const source = path.join(sourceRoot, '.next')
  if (!fs.existsSync(path.join(source, 'BUILD_ID'))) {
    throw new Error('Production build output is missing .next/BUILD_ID.')
  }
  fs.cpSync(source, path.join(targetRoot, '.next'), {
    recursive: true,
    dereference: true,
    filter: input => {
      const relative = path.relative(source, input).replaceAll('\\', '/')
      return relative !== 'cache' && !relative.startsWith('cache/')
    },
  })
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      'release-id': { type: 'string' },
      'source-url': { type: 'string' },
      output: { type: 'string' },
      manifest: { type: 'string' },
    },
    strict: true,
  })

  for (const key of ['tag', 'release-id', 'source-url', 'output', 'manifest']) {
    if (!values[key]) throw new Error(`--${key} is required.`)
  }

  const tag = validateReleaseTag(values.tag)
  const releaseId = values['release-id']
  if (!/^[A-Za-z0-9._-]{7,120}$/.test(releaseId)) {
    throw new Error('Release ID contains unsupported characters or is too long.')
  }
  const sourceUrl = validateSourceUrl(values['source-url'], tag)
  const audit = auditTagSource(tag)

  const outputPath = path.resolve(values.output)
  const manifestPath = path.resolve(values.manifest)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-release-'))
  const archivePath = path.join(tempRoot, 'source.tar')
  const extractRoot = path.join(tempRoot, 'extract')
  fs.mkdirSync(extractRoot, { recursive: true })

  try {
    const fd = fs.openSync(archivePath, 'w')
    try {
      run('git', ['archive', '--format=tar', '--prefix=release/', tag], {
        stdio: ['ignore', fd, 'inherit'],
      })
    } finally {
      fs.closeSync(fd)
    }
    run('tar', ['-xf', archivePath, '-C', extractRoot])

    const releaseRoot = path.join(extractRoot, 'release')
    for (const required of ['package.json', 'package-lock.json', 'LICENSE', 'next.config.mjs']) {
      if (!fs.existsSync(path.join(releaseRoot, required))) {
        throw new Error(`Tagged source is missing required release file: ${required}`)
      }
    }
    copyBuildOutput(process.cwd(), releaseRoot)

    const metadata = {
      schemaVersion: 1,
      tag,
      commit: audit.commit,
      releaseId,
      sourceUrl,
      fileCount: audit.fileCount,
      builtAt: new Date().toISOString(),
    }
    fs.writeFileSync(
      path.join(releaseRoot, 'release-manifest.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    )
    run('tar', ['-czf', outputPath, '-C', extractRoot, 'release'])

    const archiveSha256 = sha256File(outputPath)
    const manifest = {
      ...metadata,
      archiveFile: 'release.tar.gz',
      archiveSha256,
      archiveBytes: fs.statSync(outputPath).size,
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
