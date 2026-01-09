import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  // Create Redis INSIDE the handler
  const redis = Redis.fromEnv()

  try {
    await redis.set("healthcheck", "ok")
    const value = await redis.get("healthcheck")

    return res.status(200).json({
      ok: true,
      redis: value,
    })
  } catch (err) {
    return res.status(500).json({
      error: "Redis failed",
      message: err.message,
    })
  }
}
