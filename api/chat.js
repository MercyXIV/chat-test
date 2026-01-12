import { Redis } from "@upstash/redis"

/* ================= REDIS ================= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ================= CONFIG ================= */
const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || ""
const FEED_KEY = "chat_feed_inline_v1"
const TIMEOUT_KEY = name => `chat_timeout:${name}`
const SERVER_MAX_MESSAGES = 150

/* ================= SSE ================= */
const clients = new Set()
function sendSSE(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try { res.write(msg) } catch { clients.delete(res) }
  }
}

/* ================= HELPERS ================= */
const now = () => Date.now()
const idGen = () => `msg_${now()}_${Math.random().toString(36).slice(2, 8)}`
const norm = s => String(s || "").trim().slice(0, 400)
const isAdmin = b => ADMIN_PASSWORD && b?.adminPassword === ADMIN_PASSWORD

function headers(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Cache-Control", "no-store")
}

/* ================= HANDLER ================= */
export default async function handler(req, res) {
  headers(res)
  if (req.method === "OPTIONS") return res.end()

  const body = req.method === "POST" ? req.body || {} : req.query || {}
  const action = body.action

  /* ---------- SSE (single global GET) ---------- */
  if (action === "events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    res.write("retry: 3000\n\n")
    clients.add(res)
    req.on("close", () => clients.delete(res))
    return
  }

  try {
    /* ---------- LIST (ONE Redis command) ---------- */
    if (action === "list") {
      const raw = await redis.lrange(FEED_KEY, 0, 99)
      const messages = raw.map(v => JSON.parse(v))
      return res.json({ success: true, messages })
    }

    /* ---------- CREATE ---------- */
    if (action === "create") {
      const name = norm(body.name).slice(0, 20)
      const text = norm(body.text)
      if (!name || !text) return res.status(400).json({ success: false })
      if (await redis.get(TIMEOUT_KEY(name)))
        return res.status(403).json({ success: false })

      const msg = {
        id: idGen(),
        name,
        text,
        replyTo: body.replyTo || null,
        createdAt: now(),
        editedAt: null,
        reactions: {},
        deleted: false,
        isAdmin: isAdmin(body),
      }

      await redis.pipeline()
        .lpush(FEED_KEY, JSON.stringify(msg))
        .ltrim(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
        .exec()

      sendSSE({ type: "message", message: msg })
      return res.json({ success: true })
    }

    /* ---------- EDIT ---------- */
    if (action === "edit") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
      let updated = null

      const out = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === body.id && m.name === body.name) {
          m.text = norm(body.text)
          m.editedAt = now()
          updated = m
        }
        return JSON.stringify(m)
      })

      if (!updated) return res.status(403).json({ success: false })

      await redis.pipeline().del(FEED_KEY).lpush(FEED_KEY, ...out).exec()
      sendSSE({ type: "edit", message: updated })
      return res.json({ success: true })
    }

    /* ---------- DELETE ---------- */
    if (action === "delete") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
      let deletedId = null

      const out = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === body.id && (m.name === body.name || isAdmin(body))) {
          m.text = "[message deleted]"
          m.deleted = true
          deletedId = m.id
        }
        return JSON.stringify(m)
      })

      if (!deletedId) return res.status(403).json({ success: false })

      await redis.pipeline().del(FEED_KEY).lpush(FEED_KEY, ...out).exec()
      sendSSE({ type: "delete", id: deletedId })
      return res.json({ success: true })
    }

    /* ---------- REACT ---------- */
    if (action === "react") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
      let reactions = null

      const out = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === body.id) {
          m.reactions ||= {}
          m.reactions[body.emoji] ||= []
          const u = m.reactions[body.emoji]
          m.reactions[body.emoji] = u.includes(body.name)
            ? u.filter(x => x !== body.name)
            : [...u, body.name]
          if (m.reactions[body.emoji].length === 0)
            delete m.reactions[body.emoji]
          reactions = m.reactions
        }
        return JSON.stringify(m)
      })

      if (!reactions) return res.status(404).json({ success: false })

      await redis.pipeline().del(FEED_KEY).lpush(FEED_KEY, ...out).exec()
      sendSSE({ type: "react", id: body.id, reactions })
      return res.json({ success: true })
    }

    /* ---------- ADMIN TIMEOUT ---------- */
    if (action === "admin_timeout") {
      if (!isAdmin(body)) return res.status(403).json({ success: false })
      await redis.set(TIMEOUT_KEY(body.target), "1", { ex: body.minutes * 60 })
      return res.json({ success: true })
    }

    return res.status(400).json({ success: false })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ success: false })
  }
        }
