// /api/chat.js — FULL FEATURE CHAT (STRICT LPUSH / LRANGE)

export const config = { runtime: "nodejs" }

import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ================= CONFIG ================= */
const FEED_KEY = "chat_feed_v4"
const LIST_LIMIT = 60
const COOLDOWN_SEC = 5
const EDIT_WINDOW_MS = 10 * 60 * 1000

/* ================= HELPERS ================= */
const norm = (s, n = 200) =>
  String(s || "").replace(/\s+/g, " ").trim().slice(0, n)

const rand = () => Math.random().toString(36).slice(2, 8)
const makeGuest = () => `guest-${rand()}`

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const AVATAR_COLORS = [
  "#88ff55",
  "#5fb739",
  "#2ecc71",
  "#27ae60",
  "#16a085",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
]

function avatarFromName(name) {
  const h = hashString(name.toLowerCase())
  return {
    color: AVATAR_COLORS[h % AVATAR_COLORS.length],
    initials: name.slice(0, 2).toUpperCase(),
  }
}

/* ================= HANDLER ================= */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Cache-Control", "no-store")

  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? req.body : req.query
    const action = body.action

    /* ================= LIST ================= */
    if (action === "list") {
      const raw = await redis.lrange(FEED_KEY, 0, LIST_LIMIT - 1)
      const messages = raw
        .map((x) => {
          try {
            return JSON.parse(x)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return res.json({ success: true, messages })
    }

    /* ================= CREATE ================= */
    if (action === "create") {
      const name = norm(body.name, 20) || makeGuest()
      const text = norm(body.text, 200)
      if (!text) return res.json({ success: false })

      const msg = {
        id: Date.now() + "_" + rand(),
        name,
        text,
        createdAt: Date.now(),
        editedAt: null,
        deleted: false,
        avatar: avatarFromName(name),
      }

      await redis.lpush(FEED_KEY, JSON.stringify(msg))
      await redis.ltrim(FEED_KEY, 0, LIST_LIMIT - 1)

      return res.json({ success: true, name })
    }

    /* ================= EDIT ================= */
    if (action === "edit") {
      const id = body.id
      const text = norm(body.text, 200)
      const name = norm(body.name, 20)

      const raw = await redis.lrange(FEED_KEY, 0, LIST_LIMIT - 1)
      const list = raw.map((x) => JSON.parse(x))

      const idx = list.findIndex((m) => m.id === id)
      if (idx === -1) return res.json({ success: false })

      const msg = list[idx]
      if (
        msg.name !== name ||
        Date.now() - msg.createdAt > EDIT_WINDOW_MS
      ) {
        return res.status(403).end()
      }

      msg.text = text
      msg.editedAt = Date.now()

      list[idx] = msg
      await redis.del(FEED_KEY)
      await redis.lpush(
        FEED_KEY,
        ...list.reverse().map((m) => JSON.stringify(m))
      )

      return res.json({ success: true })
    }

    /* ================= DELETE ================= */
    if (action === "delete") {
      const id = body.id
      const name = norm(body.name, 20)

      const raw = await redis.lrange(FEED_KEY, 0, LIST_LIMIT - 1)
      const list = raw.map((x) => JSON.parse(x))

      const idx = list.findIndex((m) => m.id === id)
      if (idx === -1) return res.json({ success: false })

      const msg = list[idx]
      if (msg.name !== name) return res.status(403).end()

      msg.deleted = true
      msg.text = ""

      list[idx] = msg
      await redis.del(FEED_KEY)
      await redis.lpush(
        FEED_KEY,
        ...list.reverse().map((m) => JSON.stringify(m))
      )

      return res.json({ success: true })
    }

    return res.json({ success: false })
  } catch (err) {
    console.error("CHAT ERROR:", err)
    return res.status(500).json({ success: false })
  }
  }
