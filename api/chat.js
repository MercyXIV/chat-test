import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ================= CONFIG ================= */
const FEED_KEY = "global_chat_feed_v1"
const MSG_KEY = (id) => `chat_msg:${id}`
const USER_COOLDOWN = (u) => `chat_cd:${u}`

const MAX_LEN = 200
const COOLDOWN_SEC = 5
const MAX_MESSAGES = 80

/* ================= HELPERS ================= */
const msgId = () =>
  `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const normalize = (t) =>
  String(t || "").replace(/\s+/g, " ").trim()

function avatarFromUsername(username) {
  const colors = ["#3fa9e9", "#4aa3df", "#5bb8f0"]
  let h = 0
  for (let i = 0; i < username.length; i++) {
    h = (h << 5) - h + username.charCodeAt(i)
    h |= 0
  }
  return {
    initials: username.slice(0, 2).toUpperCase(),
    color: colors[Math.abs(h) % colors.length],
  }
}

/* ================= HANDLER ================= */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? req.body || {} : req.query || {}
    const action = String(body.action || "")

    /* -------- LIST -------- */
    if (action === "list") {
      const ids = await redis.lrange(FEED_KEY, 0, MAX_MESSAGES - 1)
      if (!ids.length) {
        return res.json({ success: true, messages: [] })
      }

      const pipe = redis.pipeline()
      ids.forEach((id) => pipe.get(MSG_KEY(id)))
      const raw = await pipe.exec()

      const messages = raw
        .map((r) => {
          try {
            const m = JSON.parse(r)
            return {
              ...m,
              time: new Date(m.createdAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return res.json({ success: true, messages })
    }

    /* -------- SEND -------- */
    if (action === "send") {
      const username = String(body.username || "").trim().toLowerCase()
      const text = normalize(body.text)

      if (!username) {
        return res
          .status(400)
          .json({ success: false, error: "NO_USERNAME" })
      }

      if (!text || text.length > MAX_LEN) {
        return res
          .status(400)
          .json({ success: false, error: "BAD_TEXT" })
      }

      if (await redis.get(USER_COOLDOWN(username))) {
        return res
          .status(429)
          .json({ success: false, error: "COOLDOWN" })
      }

      const msg = {
        id: msgId(),
        username,
        text,
        createdAt: Date.now(),
        avatar: avatarFromUsername(username),
      }

      await redis.pipeline()
        .set(MSG_KEY(msg.id), JSON.stringify(msg), { ex: 60 * 60 * 6 })
        .lpush(FEED_KEY, msg.id)
        .ltrim(FEED_KEY, 0, 300)
        .set(USER_COOLDOWN(username), "1", { ex: COOLDOWN_SEC })
        .exec()

      return res.json({ success: true, message: msg })
    }

    return res.status(400).json({ success: false, error: "BAD_ACTION" })
  } catch (e) {
    console.error("chat error:", e)
    return res.status(500).json({ success: false })
  }
}
