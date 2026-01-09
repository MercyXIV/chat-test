import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { user, message } = req.body || {}

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Invalid message" })
  }

  const payload = { user: user || "Guest", message: message.trim(), time: Date.now() }

  await redis.publish("global-chat", payload)

  return res.json({ ok: true })
}
