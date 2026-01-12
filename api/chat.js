// api/chat.js — Global chat with bounded history (OPTIMIZED)
import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || ""

/* ---------------- CORS + no-cache ---------------- */
function cors(req, res) {
  const origin = req.headers.origin || ""
  const allowed =
    origin === "https://chstestred.framer.website" ||
    origin.endsWith(".framer.website") ||
    origin.endsWith(".framer.app")

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*")
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
}

/* ---------------- Helpers ---------------- */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n))
const normName = (s) => String(s || "").trim().slice(0, 20)
const normText = (s) => String(s || "").trim().slice(0, 400)
const rand = (n = 8) =>
  [...Array(n)].map(() => Math.random().toString(36)[2]).join("")
const msgIdGen = () => `msg_${Date.now()}_${rand()}`

/* ---------------- Redis Keys ---------------- */
const FEED_KEY = "standalone_chat_feed_v2"
const COOLDOWN_KEY = (name) => `standalone_chat_cd:${name}`
const TIMEOUT_KEY = (name) => `standalone_chat_timeout:${name}`

/* ---------------- Limits ---------------- */
const SERVER_MAX_MESSAGES = 150
const CLIENT_MAX_MESSAGES = 100
const COOLDOWN_SEC = 2

const isAdmin = (body) =>
  ADMIN_PASSWORD && body?.adminPassword === ADMIN_PASSWORD

/* ========================================================= */
export default async function handler(req, res) {
  cors(req, res)
  noCache(res)
  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? (req.body || {}) : (req.query || {})
    const action = String(body.action || "")

    /* ---------- LIST (1 Redis command) ---------- */
    if (action === "list") {
      const limit = clamp(
        Number(body.limit || CLIENT_MAX_MESSAGES),
        1,
        CLIENT_MAX_MESSAGES
      )

      const raw = await redis.lrange(FEED_KEY, 0, limit - 1)
      const messages = raw.map(v => {
        try { return JSON.parse(v) } catch { return null }
      }).filter(Boolean)

      return res.status(200).json({ success: true, messages })
    }

    /* ---------- CREATE ---------- */
    if (action === "create") {
      const name = normName(body.name)
      const text = normText(body.text)
      const replyTo = body.replyTo ? String(body.replyTo) : null

      if (!name || !text)
        return res.status(400).json({ success: false })

      if (await redis.get(TIMEOUT_KEY(name)))
        return res.status(403).json({ success: false, error: "Timed out" })

      if (await redis.get(COOLDOWN_KEY(name)))
        return res.status(429).json({ success: false })

      let reply = null
      if (replyTo) {
        const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
        const parent = raw
          .map(v => { try { return JSON.parse(v) } catch { return null } })
          .find(m => m && m.id === replyTo && !m.deleted)

        if (parent) {
          reply = {
            id: parent.id,
            name: parent.name,
            text: parent.text.slice(0, 120),
          }
        }
      }

      const msg = {
        id: msgIdGen(),
        name,
        text,
        replyTo: reply,
        createdAt: Date.now(),
        editedAt: null,
        deleted: false,
      }

      await redis.pipeline()
        .set(COOLDOWN_KEY(name), "1", { ex: COOLDOWN_SEC })
        .lpush(FEED_KEY, JSON.stringify(msg))
        .ltrim(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
        .exec()

      return res.status(200).json({ success: true, message: msg })
    }

    /* ---------- EDIT ---------- */
    if (action === "edit") {
      const { id, name, text } = body
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)

      let updated = null
      const out = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === id && m.name === name && !m.deleted) {
          m.text = normText(text)
          m.editedAt = Date.now()
          updated = m
        }
        return JSON.stringify(m)
      })

      if (!updated)
        return res.status(403).json({ success: false })

      await redis.del(FEED_KEY)
      await redis.lpush(FEED_KEY, ...out)

      return res.status(200).json({ success: true })
    }

    /* ---------- DELETE ---------- */
    if (action === "delete") {
      const { id, name } = body
      const raw = await redis.lrange(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)

      let allowed = false
      const out = raw.map(v => {
        const m = JSON.parse(v)
        if (m.id === id && (m.name === name || isAdmin(body))) {
          m.deleted = true
          m.text = "[message deleted]"
          allowed = true
        }
        return JSON.stringify(m)
      })

      if (!allowed)
        return res.status(403).json({ success: false })

      await redis.del(FEED_KEY)
      await redis.lpush(FEED_KEY, ...out)

      return res.status(200).json({ success: true })
    }

    /* ---------- ADMIN: TIMEOUT ---------- */
    if (action === "admin_timeout") {
      if (!isAdmin(body))
        return res.status(403).json({ success: false })

      const target = normName(body.target)
      const minutes = clamp(Number(body.minutes || 5), 1, 1440)

      await redis.set(TIMEOUT_KEY(target), "1", { ex: minutes * 60 })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ success: false })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false })
  }
    }
