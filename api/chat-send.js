import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()

const HISTORY_KEY = "global-chat-history"
const LAST_SEND_KEY = "global-chat-last-send"
const MAX_MESSAGES = 50
const SLOWMODE_MS = 5000

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id, user, avatar, message, isAdmin } = req.body || {}

  if (!id || !user || typeof message !== "string") {
    return res.status(400).json({ error: "Invalid payload" })
  }

  try {
    if (!isAdmin) {
      const last = await redis.get(`${LAST_SEND_KEY}:${user}`)
      if (last && Date.now() - Number(last) < SLOWMODE_MS) {
        return res.status(429).json({ error: "Slow mode active" })
      }
      await redis.set(`${LAST_SEND_KEY}:${user}`, Date.now(), {
        px: SLOWMODE_MS,
      })
    }

    const payload = {
      id,
      user,
      avatar: avatar || "",
      message: message.trim(),
      time: Date.now(),          // ✅ ALWAYS SET
      edited: false,             // ✅ ALWAYS SET
    }

    await redis.lpush(HISTORY_KEY, JSON.stringify(payload))
    await redis.ltrim(HISTORY_KEY, 0, MAX_MESSAGES - 1)

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
