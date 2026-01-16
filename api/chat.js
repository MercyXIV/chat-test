import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ---------------- Config ---------------- */
const FEED_KEY = "chat_test_red_feed"
const MSG_KEY = (id) => `chat_test_red_msg:${id}`
const COOLDOWN_KEY = (u) => `chat_test_red_cd:${u}`

const MAX_MESSAGE_LENGTH = 200
const COOLDOWN_SECONDS = 5
const MAX_MESSAGES = 60

/* ---------------- Helpers ---------------- */
const msgId = () =>
  `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const normalize = (t) =>
  String(t || "").replace(/\s+/g, " ").trim()

function avatarFromUsername(username) {
  const colors = ["#88ff55", "#3498db", "#9b59b6", "#1abc9c"]
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i)
    hash |= 0
  }
  return {
    initials: username.slice(0, 2).toUpperCase(),
    color: colors[Math.abs(hash) % colors.length],
  }
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? req.body || {} : req.query || {}
    const action = String(body.action || "")

    /* ---------- LIST ---------- */
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

    /* ---------- SEND ---------- */
    if (action === "send") {
      const username = String(body.username || "").trim()
      const text = normalize(body.text)

      if (!username || !text || text.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false })
      }

      if (await redis.get(COOLDOWN_KEY(username))) {
        return res.status(429).json({ success: false, error: "COOLDOWN" })
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
        .ltrim(FEED_KEY, 0, 200)
        .set(COOLDOWN_KEY(username), "1", { ex: COOLDOWN_SECONDS })
        .exec()

      return res.json({ success: true, message: msg })
    }

    return res.status(400).json({ success: false })
  } catch (err) {
    console.error("chat error:", err)
    return res.status(500).json({ success: false })
  }
}
