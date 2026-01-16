import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ================= CONFIG ================= */

const CHAT_LIST_KEY = "chat:global"
const CHAT_MSG_KEY = (id) => `chat:msg:${id}`

const MAX_MESSAGES = 100
const MESSAGE_TTL = 60 * 60 * 6

/* ================= HELPERS ================= */

function normalize(v) {
  return String(v || "").trim()
}

function makeId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function makeGuest() {
  return `guest-${Math.random().toString(36).slice(2, 6)}`
}

/* ================= HANDLER ================= */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  try {
    const body = req.method === "POST" ? req.body || {} : req.query || {}
    const action = normalize(body.action)

    /* ========== LIST (LRANGE) ========== */
    if (action === "list") {
      const ids = await redis.lrange(CHAT_LIST_KEY, 0, MAX_MESSAGES - 1)

      if (!ids || ids.length === 0) {
        return res.json({ success: true, messages: [] })
      }

      const pipe = redis.pipeline()
      ids.forEach((id) => pipe.get(CHAT_MSG_KEY(id)))
      const raw = await pipe.exec()

      const messages = raw
        .map((r) => {
          try {
            return JSON.parse(r)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return res.json({ success: true, messages })
    }

    /* ========== SEND (LPUSH) ========== */
    if (action === "send") {
      let username = normalize(body.username).toLowerCase()
      const text = normalize(body.text)

      // 🔹 ONLY CHANGE: auto guest username
      if (!username) {
        username = makeGuest()
      }

      if (!text || text.length > 300) {
        return res
          .status(400)
          .json({ success: false, error: "BAD_TEXT" })
      }

      const id = makeId()

      const message = {
        id,
        username,
        text,
        createdAt: Date.now(),
      }

      await redis.pipeline()
        .set(CHAT_MSG_KEY(id), JSON.stringify(message), {
          ex: MESSAGE_TTL,
        })
        .lpush(CHAT_LIST_KEY, id)
        .ltrim(CHAT_LIST_KEY, 0, MAX_MESSAGES - 1)
        .exec()

      return res.json({
        success: true,
        message,
        username, // returned so frontend can persist
      })
    }

    return res
      .status(400)
      .json({ success: false, error: "UNKNOWN_ACTION" })
  } catch (err) {
    console.error("CHAT API ERROR:", err)
    return res
      .status(500)
      .json({ success: false, error: "SERVER_ERROR" })
  }
}
