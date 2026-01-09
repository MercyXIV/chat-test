import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const KEY = "global-chat-history"

export default async function handler(req, res) {
  // 🚫 absolutely no caching
  res.setHeader("Cache-Control", "no-store")

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const raw = await redis.lrange(KEY, 0, -1)

    const messages = raw
      .map((m) => {
        try {
          const x = JSON.parse(m)
          return {
            id: x.id,
            user: x.user,
            avatar: x.avatar,
            message: x.message,
            time: x.time,
            edited: !!x.edited,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .reverse()

    return res.json({ messages })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
