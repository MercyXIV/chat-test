import { Redis } from "@upstash/redis"

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  const redis = Redis.fromEnv()

  // LOG EXACTLY WHAT ARRIVES
  console.log("REQ BODY RAW:", req.body)

  const body = req.body || {}

  const message =
    body.message !== undefined
      ? String(body.message)
      : "<<<UNDEFINED>>>"

  await redis.lpush(
    "global-chat-history",
    JSON.stringify({
      user: body.user || "Guest",
      message: message,
      time: Date.now(),
    })
  )

  return res.json({
    ok: true,
    savedMessage: message,
  })
}

