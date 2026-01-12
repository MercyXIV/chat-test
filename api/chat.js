import { Redis } from "@upstash/redis"

/* REDIS */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* CONFIG */
const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || ""

const FEED_KEY = "chat_feed_inline_v1"
const TIMEOUT_KEY = name => `chat_timeout:${name}`

const SERVER_MAX_MESSAGES = 150

/* SSE (single long-lived GET per client)*/
const sseClients = new Set()

function sendSSE(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(data)
    } catch {
      sseClients.delete(res)
    }
  }
}

/* HELPERS*/
const now = () => Date.now()
const idGen = () =>
  `msg_${now()}_${Math.random().toString(36).slice(2, 8)}`
const norm = s => String(s || "").trim().slice(0, 400)
const isAdmin = body =>
  ADMIN_PASSWORD && body?.adminPassword === ADMIN_PASSWORD

/* HEADERS*/
function headers(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Cache-Control", "no-store")
}

/* HANDLER*/
export default async function handler(req, res) {
  headers(res)
  if (req.method === "OPTIONS") return res.end()

  const body = req.method === "POST" ? req.body || {} : req.query || {}
  const action = body.action

  /* SSE — ONE GET REQUEST, MANY MESSAGES */
  if (action === "events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })

    // browser auto-reconnect delay
    res.write("retry: 3000\n\n")

    sseClients.add(res)

    req.on("close", () => {
      sseClients.delete(res)
    })

    return
  }

  try {
    /* LIST — ONE REDIS COMMAND ON REFRESH*/
    if (action === "list") {
      const raw = await redis.lrange(FEED_KEY, 0, 99)

      const messages = raw
        .map(v => {
          try {
            return JSON.parse(v)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return res.json({ success: true, messages })
    }

    /*CREATE MESSAGE*/
    if (action === "create") {
      const name = norm(body.name).slice(0, 20)
      const text = norm(body.text)

      if (!name || !text) {
        return res.status(400).json({ success: false })
      }

      if (await redis.get(TIMEOUT_KEY(name))) {
        return res.status(403).json({ success: false })
      }

      const msg = {
        id: idGen(),
        name,
        text,
        replyTo: body.replyTo || null,
        createdAt: now(),
        editedAt: null,
        reactions: {},
        deleted: false,
      }

      await redis.pipeline()
        .lpush(FEED_KEY, JSON.stringify(msg))
        .ltrim(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
        .exec()

      // 🔥 one SSE event, zero Redis reads
      sendSSE({ type: "message", message: msg })

      return res.json({ success: true })
    }

    /*EDIT MESSAGE (rewrite feed once)*/
    if (action === "edit") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)

      let updatedMsg = null
      const updated = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === body.id && m.name === body.name) {
          m.text = norm(body.text)
          m.editedAt = now()
          updatedMsg = m
        }
        return JSON.stringify(m)
      })

      if (!updatedMsg) {
        return res.status(403).json({ success: false })
      }

      await redis.pipeline()
        .del(FEED_KEY)
        .lpush(FEED_KEY, ...updated)
        .exec()

      sendSSE({ type: "edit", message: updatedMsg })

      return res.json({ success: true })
    }

    /* DELETE MESSAGE (owner or admin)*/
    if (action === "delete") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)

      let deletedId = null
      const updated = raw.map(v => {
        const m = JSON.parse(v)
        if (
          m.id === body.id &&
          (m.name === body.name || isAdmin(body))
        ) {
          m.text = "[message deleted]"
          m.deleted = true
          deletedId = m.id
        }
        return JSON.stringify(m)
      })

      if (!deletedId) {
        return res.status(403).json({ success: false })
      }

      await redis.pipeline()
        .del(FEED_KEY)
        .lpush(FEED_KEY, ...updated)
        .exec()

      sendSSE({ type: "delete", id: deletedId })

      return res.json({ success: true })
    }

    /* EMOJI REACTION (persisted, toggled)*/
    if (action === "react") {
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)

      let updatedReactions = null
      const updated = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === body.id) {
          m.reactions ||= {}
          m.reactions[body.emoji] ||= []

          const users = m.reactions[body.emoji]
          m.reactions[body.emoji] = users.includes(body.name)
            ? users.filter(u => u !== body.name)
            : [...users, body.name]

          if (m.reactions[body.emoji].length === 0) {
            delete m.reactions[body.emoji]
          }

          updatedReactions = m.reactions
        }
        return JSON.stringify(m)
      })

      if (!updatedReactions) {
        return res.status(404).json({ success: false })
      }

      await redis.pipeline()
        .del(FEED_KEY)
        .lpush(FEED_KEY, ...updated)
        .exec()

      sendSSE({
        type: "react",
        id: body.id,
        reactions: updatedReactions,
      })

      return res.json({ success: true })
    }

    /*ADMIN TIMEOUT */
    if (action === "admin_timeout") {
      if (!isAdmin(body)) {
        return res.status(403).json({ success: false })
      }

      await redis.set(TIMEOUT_KEY(body.target), "1", {
        ex: body.minutes * 60,
      })

      return res.json({ success: true })
    }

    return res.status(400).json({ success: false })
  } catch (err) {
    console.error("CHAT BACKEND ERROR:", err)
    return res.status(500).json({ success: false })
  }
      }
