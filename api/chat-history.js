import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Expires", "0")

  const redis = Redis.fromEnv()

  const raw = await redis.lrange("global-chat-history", 0, -1)

  const messages = raw
    .map((m) => {
      try {
        return JSON.parse(m)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .reverse()

  return res.json({ messages })
}

