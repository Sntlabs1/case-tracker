// Local-dev shim: mounts api/*.js as routes under /api/* with a Vercel-shaped
// (req, res). Loads .env.local into process.env so handlers see ANTHROPIC_API_KEY,
// KV creds, etc. Used only by `vite` in dev — production still runs on real Vercel.

import { resolve, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal(root) {
  const envPath = resolve(root, '.env.local')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function decorateRes(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = (data) => {
    if (data && typeof data === 'object' && !Buffer.isBuffer(data)) return res.json(data)
    res.end(data == null ? '' : (Buffer.isBuffer(data) ? data : String(data)))
    return res
  }
  res.redirect = (location, status = 302) => {
    res.statusCode = status
    res.setHeader('Location', location)
    res.end()
    return res
  }
  return res
}

async function readBody(req) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  const ct = String(req.headers['content-type'] || '')
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw) } catch { return raw }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw))
  }
  return raw
}

export default function vercelApi() {
  return {
    name: 'vercel-api-dev',
    configResolved(config) {
      loadEnvLocal(config.root)
    },
    configureServer(server) {
      const apiDir = resolve(server.config.root, 'api')

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
        const slug = url.pathname
          .replace(/^\/api\//, '')
          .replace(/\/+$/, '')
          .split('/')[0]

        if (!slug) return next()

        const filePath = join(apiDir, `${slug}.js`)
        if (!existsSync(filePath)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: `No api/${slug}.js found` }))
          return
        }

        try {
          const mod = await server.ssrLoadModule(filePath)
          const handler = mod.default
          if (typeof handler !== 'function') {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `api/${slug}.js has no default export` }))
            return
          }

          req.query = Object.fromEntries(url.searchParams)
          req.body = await readBody(req)
          decorateRes(res)

          await handler(req, res)
        } catch (err) {
          console.error(`[api/${slug}]`, err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }))
          }
        }
      })
    },
  }
}
