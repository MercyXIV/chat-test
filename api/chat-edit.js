import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const KEY = "global-chat-history"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id, message } = req.body || {}
  if (!id || typeof message !== "string") {
    return res.status(400).json({ error: "Bad payload" })
  }

  try {
    const all = await redis.lrange(KEY, 0, -1)
    const updated = all.map((m) => {
      const x = JSON.parse(m)
      if (x.id === id) {
        x.message = message.trim()
        x.edited = true
      }
      return JSON.stringify(x)
    })

    await redis.del(KEY)
    if (updated.length) await redis.rpush(KEY, ...updated)

    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
