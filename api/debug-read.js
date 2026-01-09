import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  const redis = Redis.fromEnv()
  const raw = await redis.lrange("global-chat-history", 0, -1)
  res.json({ raw })
}
