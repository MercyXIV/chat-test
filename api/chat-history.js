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
    const messages = raw.map((m) => JSON.parse(m)).reverse()
    return res.json({ messages })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
