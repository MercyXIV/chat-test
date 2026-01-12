import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ================= CONFIG ================= */
const FEED_KEY = "chat_feed_release"
const TYPING_KEY = "chat_typing"
const TIMEOUT_KEY = name => `chat_timeout:${name}`
const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || ""

const MAX_MESSAGES = 150
const POLL_LIMIT = 100
const RATE_LIMIT_SEC = 2
const RATE_KEY = name => `chat_rate:${name}`

/* ================= HELPERS ================= */
const now = () => Date.now()
const id = () => `m_${now()}_${Math.random().toString(36).slice(2, 6)}`
const norm = s => String(s || "").trim().slice(0, 400)
const isAdmin = b => ADMIN_PASSWORD && b.adminPassword === ADMIN_PASSWORD

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

  const body = req.method === "POST" ? req.body : req.query
  const action = body.action

  /* ---------- LIST ---------- */
  if (action === "list") {
    const raw = await redis.lrange(FEED_KEY, 0, POLL_LIMIT - 1)
    return res.json({
      success: true,
      messages: raw.map(JSON.parse),
      typing: await redis.smembers(TYPING_KEY),
    })
  }

  /* ---------- CREATE ---------- */
  if (action === "create") {
    const name = norm(body.name).slice(0, 20)
    const text = norm(body.text)
    if (!name || !text) return res.status(400).json({ success: false })

    if (await redis.get(TIMEOUT_KEY(name)))
      return res.status(403).json({ success: false })

    if (await redis.get(RATE_KEY(name)))
      return res.status(429).json({ success: false })

    const msg = {
      id: id(),
      name,
      text,
      createdAt: now(),
      reactions: {},
      deleted: false,
      isAdmin: isAdmin(body),
    }

    await redis.pipeline()
      .lpush(FEED_KEY, JSON.stringify(msg))
      .ltrim(FEED_KEY, 0, MAX_MESSAGES - 1)
      .set(RATE_KEY(name), "1", { ex: RATE_LIMIT_SEC })
      .exec()

    return res.json({ success: true })
  }

  /* ---------- REACT ---------- */
  if (action === "react") {
    const raw = await redis.lrange(FEED_KEY, 0, MAX_MESSAGES - 1)
    const updated = raw.map(v => {
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
      }
      return JSON.stringify(m)
    })

    await redis.del(FEED_KEY)
    await redis.lpush(FEED_KEY, ...updated)

    return res.json({ success: true })
  }

  /* ---------- DELETE (ADMIN) ---------- */
  if (action === "delete") {
    if (!isAdmin(body)) return res.status(403).json({ success: false })

    const raw = await redis.lrange(FEED_KEY, 0, MAX_MESSAGES - 1)
    const updated = raw.map(v => {
      const m = JSON.parse(v)
      if (m.id === body.id) {
        m.text = "[message deleted]"
        m.deleted = true
      }
      return JSON.stringify(m)
    })

    await redis.del(FEED_KEY)
    await redis.lpush(FEED_KEY, ...updated)

    return res.json({ success: true })
  }

  /* ---------- TYPING ---------- */
  if (action === "typing") {
    await redis.sadd(TYPING_KEY, body.name)
    await redis.expire(TYPING_KEY, 5)
    return res.json({ success: true })
  }

  return res.status(400).json({ success: false })
}
