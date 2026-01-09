import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const KEY = "global-chat-history"

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { id, user, avatar, message, time } = req.body || {}

  if (!id || !user || typeof message !== "string") {
    return res.status(400).json({ error: "Bad payload" })
  }

  const payload = {
    id,
    user,
    avatar: avatar || "",
    message: message.trim(),
    time: typeof time === "number" ? time : Date.now(),
    edited: false,
  }

  try {
    await redis.lpush(KEY, JSON.stringify(payload))
    await redis.ltrim(KEY, 0, 99)
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
