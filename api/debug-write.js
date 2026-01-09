import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  const redis = Redis.fromEnv()

  const payload = {
    id: "debug-" + Date.now(),
    user: "Debug",
    avatar: "",
    message: "Hello from debug",
    time: Date.now(),
  }

  await redis.lpush("global-chat-history", JSON.stringify(payload))
  return res.json({ ok: true })
}
