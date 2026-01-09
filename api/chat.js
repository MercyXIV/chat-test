import { Redis } from "@upstash/redis"

export const config = {
  runtime: "nodejs",
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const CHAT_KEY = "global_chat"

export default async function handler(req, res) {
  // 🔴 Disable ALL caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Expires", "0")
  res.setHeader("Surrogate-Control", "no-store")

  if (req.method === "POST") {
    const { user, text } = req.body || {}

    if (!user || !text) {
      return res.status(400).json({ error: "Invalid payload" })
    }

    const message = {
      user,
      text,
      time: Date.now(),
    }

    await redis.rpush(CHAT_KEY, message)
    return res.status(200).json({ ok: true })
  }

  if (req.method === "GET") {
    const messages = await redis.lrange(CHAT_KEY, 0, -1)
    return res.status(200).json({ messages })
  }

  return res.status(405).end()
}
