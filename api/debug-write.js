import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()

export default async function handler(req, res) {
  try {
    await redis.lpush(
      "global-chat-history",
      JSON.stringify({
        id: "test",
        user: "Debug",
        message: "Hello from debug",
        time: Date.now(),
      })
    )
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

