// api/chat.js — standalone global chat (trades-style feed)
import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ---------------- CORS + no-cache ---------------- */
function cors(req, res) {
  const origin = req.headers.origin || ""
  res.setHeader("Access-Control-Allow-Origin", origin || "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
}

/* ---------------- Helpers (same pattern as trades.js) ---------------- */
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

function safeParse(v) {
  const x = unwrap(v)
  if (!x) return null
  if (typeof x === "object") return x
  try { return JSON.parse(x) } catch { return null }
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

const normName = (s) => String(s || "").trim().slice(0, 20)
const normText = (s) => String(s || "").trim().slice(0, 400)

const rand = (n = 8) =>
  [...Array(n)].map(() => Math.random().toString(36)[2]).join("")

const msgIdGen = () => `msg_${Date.now()}_${rand()}`

/* ---------------- Keys ---------------- */
const FEED_KEY = "standalone_chat_feed_v1"
const MSG_KEY = (id) => `standalone_chat_msg:${id}`
const COOLDOWN_KEY = (name) => `standalone_chat_cd:${name}`

/* ---------------- Config ---------------- */
const DEFAULT_LIMIT = 120
const MESSAGE_TTL = 60 * 60 * 6 // 6 hours
const COOLDOWN_SEC = 2

/* =========================================================
   HANDLER
========================================================= */
export default async function handler(req, res) {
  cors(req, res)
  noCache(res)
  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? (req.body || {}) : (req.query || {})
    const action = String(body.action || "")
    if (!action) {
      return res.status(400).json({ success: false, error: "Missing action" })
    }

    /* ---------------- LIST ---------------- */
    if (action === "list") {
      const limit = clamp(Number(body.limit || DEFAULT_LIMIT), 1, 300)
      const ids = (await redis.lrange(FEED_KEY, 0, limit - 1)) || []

      if (!ids.length) {
        return res.status(200).json({ success: true, messages: [] })
      }

      const pipe = redis.pipeline()
      for (const id of ids) pipe.get(MSG_KEY(id))
      const raw = await pipe.exec()

      const messages = []
      const missing = []

      for (let i = 0; i < ids.length; i++) {
        const obj = safeParse(raw[i])
        if (!obj || !obj.id) {
          missing.push(ids[i])
          continue
        }
        messages.push(obj)
      }

      if (missing.length) {
        const p2 = redis.pipeline()
        for (const id of missing) p2.lrem(FEED_KEY, 0, id)
        await p2.exec()
      }

      return res.status(200).json({ success: true, messages })
    }

    /* ---------------- CREATE ---------------- */
    if (action === "create") {
      const name = normName(body.name)
      const text = normText(body.text)

      if (!name) {
        return res.status(400).json({ success: false, error: "Missing name" })
      }
      if (!text) {
        return res.status(400).json({ success: false, error: "Empty message" })
      }

      const cd = await redis.get(COOLDOWN_KEY(name))
      if (cd) {
        return res.status(429).json({ success: false, error: "Cooldown" })
      }

      const id = msgIdGen()
      const msg = {
        id,
        name,
        text,
        createdAt: Date.now(),
      }

      await redis.pipeline()
        .set(COOLDOWN_KEY(name), "1", { ex: COOLDOWN_SEC })
        .set(MSG_KEY(id), JSON.stringify(msg), { ex: MESSAGE_TTL })
        .lpush(FEED_KEY, id)
        .ltrim(FEED_KEY, 0, DEFAULT_LIMIT - 1)
        .exec()

      return res.status(200).json({ success: true, message: msg })
    }

    return res.status(400).json({ success: false, error: "Unknown action" })
  } catch (err) {
    console.error("standalone chat error:", err)
    return res.status(500).json({ success: false, error: "Server error" })
  }
        }
