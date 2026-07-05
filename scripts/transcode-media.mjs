import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const home = process.env.HOME || ''
const sourceRoot = path.resolve(process.argv[2] || process.env.MEDIA_SOURCE || path.join(home, 'Desktop/video/mp4格式'))
const outputRoot = path.resolve(process.argv[3] || process.env.MEDIA_OUTPUT || path.join(home, 'Desktop/video/browser-mp4'))
const force = process.argv.includes('--force') || process.env.MEDIA_FORCE === '1'

async function resolveFfmpeg() {
  const system = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  if (system.status === 0) return 'ffmpeg'

  try {
    const ffmpeg = await import('@ffmpeg-installer/ffmpeg')
    return ffmpeg.default?.path ?? ffmpeg.path
  } catch {
    throw new Error('ffmpeg not found. Install ffmpeg or run `npm install` to use @ffmpeg-installer/ffmpeg.')
  }
}

function needsTranscode(input, output) {
  if (force || !existsSync(output)) return true
  return statSync(output).mtimeMs < statSync(input).mtimeMs
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}

if (!existsSync(sourceRoot)) {
  throw new Error(`Media source not found: ${sourceRoot}`)
}

mkdirSync(outputRoot, { recursive: true })

const ffmpeg = await resolveFfmpeg()
const inputs = readdirSync(sourceRoot)
  .filter((name) => /\.mp4$/i.test(name))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

console.log(`Source: ${sourceRoot}`)
console.log(`Output: ${outputRoot}`)
console.log(`Files: ${inputs.length}`)

for (const [index, name] of inputs.entries()) {
  const input = path.join(sourceRoot, name)
  const output = path.join(outputRoot, name)
  const tempOutput = path.join(outputRoot, `.${name}.tmp.mp4`)

  if (!needsTranscode(input, output)) {
    console.log(`[${index + 1}/${inputs.length}] skip ${name}`)
    continue
  }

  console.log(`[${index + 1}/${inputs.length}] transcode ${name}`)
  if (existsSync(tempOutput)) unlinkSync(tempOutput)
  await run(ffmpeg, [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-level:v',
    '5.2',
    '-tag:v',
    'avc1',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    tempOutput,
  ])
  renameSync(tempOutput, output)
}

console.log('Done. Start `npm run media:serve` to serve the browser-compatible media.')
