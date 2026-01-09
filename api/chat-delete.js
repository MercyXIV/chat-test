import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const HISTORY_KEY = "global-chat-history"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id } = req.body || {}

  if (!id) {
    return res.status(400).json({ error: "Missing message id" })
  }

  try {
    const all = await redis.lrange(HISTORY_KEY, 0, -1)
    const filtered = all.filter((m) => {
      try {
        return JSON.parse(m).id !== id
      } catch {
        return true
      }
    })

    await redis.del(HISTORY_KEY)
    if (filtered.length) {
      await redis.rpush(HISTORY_KEY, ...filtered)
    }

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
