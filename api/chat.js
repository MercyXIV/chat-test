import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const CHAT_KEY = "global_chat"

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { user, text } = req.body

    if (
      !user ||
      !text ||
      typeof user !== "string" ||
      typeof text !== "string"
    ) {
      return res.status(400).json({ error: "Invalid payload" })
    }

    await redis.rpush(CHAT_KEY, {
      user,
      text,
      time: Date.now(),
    })

    return res.status(200).json({ ok: true })
  }

  if (req.method === "GET") {
    const messages = await redis.lrange(CHAT_KEY, 0, -1)
    return res.status(200).json({ messages })
  }

  return res.status(405).end()
}
