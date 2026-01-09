import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const redis = Redis.fromEnv()

  const { user, message } = req.body || {}

  if (
    !message ||
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > 200
  ) {
    return res.status(400).json({ error: "Invalid message" })
  }

  try {
    await redis.publish("global-chat", {
      user: user || "Guest",
      message: message.trim(),
      time: Date.now(),
    })

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({
      error: "Publish failed",
      message: err.message,
    })
  }
}
