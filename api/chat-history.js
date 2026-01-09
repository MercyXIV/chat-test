import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const HISTORY_KEY = "global-chat-history"
const MAX_MESSAGES = 50

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const raw = await redis.lrange(HISTORY_KEY, 0, MAX_MESSAGES - 1)

    const messages = raw
      .map((m) => {
        try {
          const msg = JSON.parse(m)

          // 🔒 sanitize
          return {
            id: msg.id || crypto.randomUUID(),
            user: msg.user || "Unknown",
            avatar: msg.avatar || "",
            message: typeof msg.message === "string" ? msg.message : "",
            time: typeof msg.time === "number" ? msg.time : Date.now(),
            edited: !!msg.edited,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .reverse()

    return res.json({ messages })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
