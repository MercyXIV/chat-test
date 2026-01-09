import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const KEY = "global-chat-history"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: "Missing id" })

  try {
    const all = await redis.lrange(KEY, 0, -1)
    const keep = all.filter((m) => {
      try {
        return JSON.parse(m).id !== id
      } catch {
        return true
      }
    })

    await redis.del(KEY)
    if (keep.length) await redis.rpush(KEY, ...keep)

    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
