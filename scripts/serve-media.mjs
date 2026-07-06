import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultRoot = path.join(projectRoot, 'public', 'media')
const rootArg = process.argv[2] || process.env.MEDIA_ROOT || defaultRoot
const port = Number(process.argv[3] || 4174)
const root = path.resolve(rootArg)

function send(res, status, headers = {}, body = '') {
  res.writeHead(status, headers)
  res.end(body)
}

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const file = path.resolve(root, name)

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    send(res, 404, {}, 'Not found')
    return
  }

  const size = statSync(file).size
  const range = req.headers.range
  const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
  }

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match?.[1] ? Number(match[1]) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1

    if (start >= size || end >= size || start > end) {
      send(res, 416, { 'Content-Range': `bytes */${size}` })
      return
    }

    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`Media server: http://127.0.0.1:${port}`)
  console.log(`Serving: ${root}`)
})
