import { Redis } from "@upstash/redis"

const redis = Redis.fromEnv()
const KEY = "global-chat-history"

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const raw = await redis.lrange(KEY, 0, -1)

    const messages = raw
      .map((m) => {
        try {
          const x = JSON.parse(m)
          return {
            id: x.id || crypto.randomUUID(),
            user: typeof x.user === "string" ? x.user : "Unknown",
            avatar:
              typeof x.avatar === "string" && x.avatar.length > 5
                ? x.avatar
                : "",
            message:
              typeof x.message === "string" ? x.message : "",
            time: typeof x.time === "number" ? x.time : Date.now(),
            edited: !!x.edited,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .reverse()

    return res.json({ messages })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
