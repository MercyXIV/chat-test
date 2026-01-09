import { Redis } from "@upstash/redis"

export const config = { runtime: "nodejs" }

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const KEY = "chat_messages"

export default async function handler(req, res) {
  // kill ALL caching, forever
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "POST") {
    const { user, text } = req.body || {}

    if (!user || !text) {
      return res.status(400).json({ error: "invalid" })
    }

    const msg = {
      user,
      text,
      time: Date.now(),
    }

    await redis.rpush(KEY, JSON.stringify(msg))
    return res.status(200).json({ ok: true })
  }

  if (req.method === "GET") {
    const raw = await redis.lrange(KEY, 0, -1)
    const messages = raw.map((m) => JSON.parse(m))
    return res.status(200).json({ messages })
  }

  return res.status(405).end()
}
