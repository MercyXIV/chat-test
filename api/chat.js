// api/chat.js — Global chat with SSE (FINAL)
import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || ""

/* ================= SSE ================= */
const sseClients = new Set()

function sendSSE(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(msg)
    } catch {
      sseClients.delete(res)
    }
  }
}

/* ================= Helpers ================= */
const unwrap = (v) => {
  let x = v
  for (let i = 0; i < 8; i++) {
    if (x == null) return null
    if (Array.isArray(x)) { x = x[0]; continue }
    if (typeof x === "object" && x && "result" in x) { x = x.result; continue }
    break
  }
  return x
}
const safeParse = (v) => {
  const x = unwrap(v)
  if (!x) return null
  if (typeof x === "object") return x
  try { return JSON.parse(x) } catch { return null }
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))
const normName = (s) => String(s || "").trim().slice(0, 20)
const normText = (s) => String(s || "").trim().slice(0, 400)
const rand = (n = 8) => [...Array(n)].map(() => Math.random().toString(36)[2]).join("")
const msgId = () => `msg_${Date.now()}_${rand()}`

/* ================= Redis Keys ================= */
const FEED_KEY = "chat_feed_v1"
const MSG_KEY = (id) => `chat_msg:${id}`
const COOLDOWN_KEY = (name) => `chat_cd:${name}`
const TIMEOUT_KEY = (name) => `chat_timeout:${name}`

/* ================= Limits ================= */
const SERVER_MAX = 150
const CLIENT_MAX = 100
const COOLDOWN_SEC = 2

const isAdmin = (b) => ADMIN_PASSWORD && b?.adminPassword === ADMIN_PASSWORD

/* ================= CORS ================= */
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Cache-Control", "no-store")
}

/* ================= Handler ================= */
export default async function handler(req, res) {
  cors(req, res)
  if (req.method === "OPTIONS") return res.end()

  const body = req.method === "POST" ? req.body || {} : req.query || {}
  const action = String(body.action || "")

  /* -------- SSE STREAM -------- */
  if (action === "events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    res.write("retry: 3000\n\n")
    sseClients.add(res)
    req.on("close", () => sseClients.delete(res))
    return
  }

  try {
    /* -------- LIST -------- */
    if (action === "list") {
      const limit = clamp(Number(body.limit || CLIENT_MAX), 1, CLIENT_MAX)
      const ids = await redis.lrange(FEED_KEY, 0, limit - 1)

      const pipe = redis.pipeline()
      ids.forEach(id => pipe.get(MSG_KEY(id)))
      const raw = await pipe.exec()

      const messages = []
      const missing = []

      ids.forEach((id, i) => {
        const m = safeParse(raw[i])
        if (!m) missing.push(id)
        else messages.push(m)
      })

      if (missing.length) {
        const p = redis.pipeline()
        missing.forEach(id => p.lrem(FEED_KEY, 0, id))
        await p.exec()
      }

      return res.json({ success: true, messages })
    }

    /* -------- CREATE -------- */
    if (action === "create") {
      const name = normName(body.name)
      const text = normText(body.text)
      if (!name || !text) return res.status(400).json({ success: false })
      if (await redis.get(TIMEOUT_KEY(name))) return res.status(403).json({ success: false })
      if (await redis.get(COOLDOWN_KEY(name))) return res.status(429).json({ success: false })

      let reply = null
      if (body.replyTo) {
        const parent = safeParse(await redis.get(MSG_KEY(body.replyTo)))
        if (parent && !parent.deleted) {
          reply = { id: parent.id, name: parent.name, text: parent.text.slice(0, 120) }
        }
      }

      const msg = {
        id: msgId(),
        name,
        text,
        replyTo: reply,
        createdAt: Date.now(),
        editedAt: null,
        deleted: false,
      }

      await redis.pipeline()
        .set(COOLDOWN_KEY(name), "1", { ex: COOLDOWN_SEC })
        .set(MSG_KEY(msg.id), JSON.stringify(msg))
        .lpush(FEED_KEY, msg.id)
        .ltrim(FEED_KEY, 0, SERVER_MAX - 1)
        .exec()

      sendSSE({ type: "message", message: msg })
      return res.json({ success: true })
    }

    /* -------- EDIT -------- */
    if (action === "edit") {
      const m = safeParse(await redis.get(MSG_KEY(body.id)))
      if (!m || m.name !== body.name) return res.status(403).json({ success: false })
      m.text = normText(body.text)
      m.editedAt = Date.now()
      await redis.set(MSG_KEY(m.id), JSON.stringify(m))
      sendSSE({ type: "edit", id: m.id, text: m.text, editedAt: m.editedAt })
      return res.json({ success: true })
    }

    /* -------- DELETE -------- */
    if (action === "delete") {
      const m = safeParse(await redis.get(MSG_KEY(body.id)))
      if (!m) return res.status(404).json({ success: false })
      if (m.name !== body.name && !isAdmin(body)) return res.status(403).json({ success: false })
      m.deleted = true
      m.text = "[message deleted]"
      await redis.set(MSG_KEY(m.id), JSON.stringify(m))
      sendSSE({ type: "delete", id: m.id })
      return res.json({ success: true })
    }

    /* -------- ADMIN TIMEOUT -------- */
    if (action === "admin_timeout") {
      if (!isAdmin(body)) return res.status(403).json({ success: false })
      await redis.set(TIMEOUT_KEY(normName(body.target)), "1", {
        ex: clamp(Number(body.minutes || 5), 1, 1440) * 60,
      })
      return res.json({ success: true })
    }

    return res.status(400).json({ success: false })
  } catch {
    return res.status(500).json({ success: false })
  }
        }
