import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const HISTORY_KEY = "global-chat-history"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id, message, user, isAdmin } = req.body || {}

  if (!id || !message) {
    return res.status(400).json({ error: "Invalid request" })
  }

  try {
    const all = await redis.lrange(HISTORY_KEY, 0, -1)
    const updated = all.map((m) => {
      const msg = JSON.parse(m)
      if (msg.id === id && (isAdmin || msg.user === user)) {
        msg.message = message.trim()
        msg.edited = true
      }
      return JSON.stringify(msg)
    })

    await redis.del(HISTORY_KEY)
    if (updated.length) {
      await redis.rpush(HISTORY_KEY, ...updated)
    }

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
