import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  const redis = Redis.fromEnv()

  try {
    // Log proves function is hit
    console.log("CHAT-SEND HIT")

    await redis.lpush(
      "global-chat-history",
      JSON.stringify({
        id: Date.now().toString(),
        user: req.body?.user || "Anonymous",
        message: req.body?.message || "",
        time: Date.now(),
      })
    )

    console.log("LPUSH DONE")

    return res.json({ ok: true })
  } catch (e) {
    console.error("CHAT-SEND ERROR", e)
    return res.status(500).json({ error: e.message })
  }
}
