import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const CHAT_KEY = "global_chat"

export default async function handler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  let lastLength = await redis.llen(CHAT_KEY)

  const interval = setInterval(async () => {
    const currentLength = await redis.llen(CHAT_KEY)

    if (currentLength > lastLength) {
      const newMessages = await redis.lrange(
        CHAT_KEY,
        lastLength,
        currentLength - 1
      )

      newMessages.forEach((msg) => {
        res.write(`data: ${JSON.stringify(msg)}\n\n`)
      })

      lastLength = currentLength
    }
  }, 1000)

  req.on("close", () => {
    clearInterval(interval)
    res.end()
  })
}
