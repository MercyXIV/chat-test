import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  // Basic method check FIRST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  // Validate env vars safely
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return res.status(500).json({
      error: "Upstash env vars missing",
      hasUrl: !!url,
      hasToken: !!token,
    })
  }

  const redis = new Redis({ url, token })

  const { user, message } = req.body || {}

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Invalid message" })
  }

  await redis.publish("global-chat", {
    user: user || "Guest",
    message: message.trim(),
    time: Date.now(),
  })

  return res.json({ ok: true })
}
