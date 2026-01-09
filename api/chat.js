import { Redis } from "@upstash/redis"

export const config = { runtime: "nodejs" }

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// ONE key. Never change this again.
const CHAT_KEY = "chat_messages_main"

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "POST") {
    const { user, text } = req.body || {}

    if (
      typeof user !== "string" ||
      typeof text !== "string" ||
      !user.trim() ||
      !text.trim()
    ) {
      return res.status(400).json({ error: "invalid payload" })
    }

    const message = {
      user,
      text,
      time: Date.now(),
    }

    // STORE AS STRING (important)
    await redis.rpush(CHAT_KEY, JSON.stringify(message))

    return res.json({ ok: true })
  }

  if (req.method === "GET") {
    const raw = await redis.lrange(CHAT_KEY, 0, -1)
    const messages = raw.map((m) => JSON.parse(m))
    return res.json({ messages })
  }

  res.status(405).end()
}
