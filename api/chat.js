// api/chat.js — FINAL GLOBAL CHAT BACKEND (FULL FEATURE SET)

import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

/* ======================================================
   CORS + NO CACHE
====================================================== */
function cors(req, res) {
  const origin = req.headers.origin || ""
  const allowed =
    origin === "https://chatestred.framer.website/" ||
    origin.endsWith(".framer.website") ||
    origin.endsWith(".framer.app")

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*")
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Password"
  )
}

function noCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  )
}

/* ======================================================
   HELPERS
====================================================== */
const normName = (s) => String(s || "").trim().slice(0, 20)
const normText = (s) =>
  String(s || "").replace(/\s+/g, " ").trim().slice(0, 200)

const rand = (n = 6) =>
  [...Array(n)].map(() => Math.random().toString(36)[2]).join("")

const msgIdGen = () => `msg_${Date.now()}_${rand()}`

function isAdmin(req, body) {
  const pass = process.env.CHAT_ADMIN_PASSWORD
  return (
    pass &&
    (req.headers["x-admin-password"] === pass ||
      body.adminPassword === pass)
  )
}

/* ======================================================
   STATIC AVATAR
====================================================== */
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
  const hash = hashString(name.toLowerCase())
  return {
    color: AVATAR_COLORS[hash % AVATAR_COLORS.length],
    initials: name.slice(0, 2).toUpperCase(),
  }
}

/* ======================================================
   RANK SYSTEM
====================================================== */
const USER_MSG_COUNT_KEY = "chat_user_msg_count_v1"

function getRank(count) {
  if (count < 10) return { roman: "I", color: "#9aa3ad" }
  if (count < 25) return { roman: "II", color: "#5fb739" }
  if (count < 50) return { roman: "III", color: "#45aaf2" }
  if (count < 100) return { roman: "IV", color: "#9b59b6" }
  if (count < 200) return { roman: "V", color: "#f1c40f" }
  if (count < 400) return { roman: "VI", color: "#e67e22" }
  if (count < 800) return { roman: "VII", color: "#e74c3c" }
  return { roman: "VIII", color: "#ff4757" }
}

/* ======================================================
   REDIS KEYS
====================================================== */
const FEED_KEY = "chat_feed_v4"
const MSG_KEY = (id) => `chat_msg:${id}`
const COOLDOWN_KEY = (name) => `chat_cd:${name}`
const SHADOWBAN_KEY = "chat_shadowban_v1"

/* ======================================================
   CONFIG
====================================================== */
const LIST_LIMIT = 60
const COOLDOWN_SEC = 5
const EDIT_WINDOW_MS = 10 * 60 * 1000
const MESSAGE_TTL = 60 * 60 * 6 // 6 hours

/* ======================================================
   HANDLER
====================================================== */
export default async function handler(req, res) {
  cors(req, res)
  noCache(res)
  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const body = req.method === "POST" ? req.body : req.query
    const action = body.action
    const admin = isAdmin(req, body)

    /* ================= LIST ================= */
    if (action === "list") {
      const viewer = normName(body.name)
      const shadowed = admin
        ? {}
        : await redis.hgetall(SHADOWBAN_KEY)

      const ids = await redis.lrange(FEED_KEY, 0, LIST_LIMIT - 1)
      const messages = []

      for (const id of ids) {
        const raw = await redis.get(MSG_KEY(id))
        if (!raw) continue

        const msg = JSON.parse(raw)

        if (
          !admin &&
          shadowed[msg.name] === "1" &&
          msg.name !== viewer
        ) {
          continue
        }

        messages.push({
          id: msg.id,
          username: msg.name,
          visibleText: msg.deleted
            ? "[message deleted]"
            : msg.text,
          avatar: msg.avatar,
          rank: msg.rank,
          time: {
            unix: msg.createdAt,
            label: new Date(msg.createdAt).toLocaleString(),
          },
          deleted: msg.deleted,
          isAdmin: msg.isAdmin,
        })
      }

      return res.json({ success: true, messages })
    }

    /* ================= CREATE ================= */
    if (action === "create") {
      const name = normName(body.name)
      const text = normText(body.text)

      if (!name || !text) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid input" })
      }

      if (!admin && (await redis.get(COOLDOWN_KEY(name)))) {
        return res
          .status(429)
          .json({ success: false, error: "Slowmode" })
      }

      const count = await redis.hincrby(
        USER_MSG_COUNT_KEY,
        name,
        1
      )
      const rank = getRank(count)

      const msg = {
        id: msgIdGen(),
        name,
        text,
        createdAt: Date.now(),
        editedAt: null,
        deleted: false,
        avatar: avatarFromName(name),
        rank,
        isAdmin: admin,
      }

      await redis.pipeline()
        .set(MSG_KEY(msg.id), JSON.stringify(msg), {
          ex: MESSAGE_TTL,
        })
        .lpush(FEED_KEY, msg.id)
        .ltrim(FEED_KEY, 0, LIST_LIMIT - 1)
        .exec()

      if (!admin) {
        await redis.set(COOLDOWN_KEY(name), "1", {
          ex: COOLDOWN_SEC,
        })
      }

      return res.json({ success: true })
    }

    /* ================= EDIT ================= */
    if (action === "edit") {
      const id = body.id
      const text = normText(body.text)
      const name = normName(body.name)

      const raw = await redis.get(MSG_KEY(id))
      if (!raw) return res.json({ success: false })

      const msg = JSON.parse(raw)

      if (
        !admin &&
        (msg.name !== name ||
          Date.now() - msg.createdAt > EDIT_WINDOW_MS)
      ) {
        return res.status(403).end()
      }

      msg.text = text
      msg.editedAt = Date.now()

      await redis.set(MSG_KEY(id), JSON.stringify(msg))
      return res.json({ success: true })
    }

    /* ================= DELETE ================= */
    if (action === "delete") {
      const id = body.id
      const name = normName(body.name)

      const raw = await redis.get(MSG_KEY(id))
      if (!raw) return res.json({ success: false })

      const msg = JSON.parse(raw)

      if (!admin && msg.name !== name) {
        return res.status(403).end()
      }

      msg.deleted = true
      msg.text = ""

      await redis.set(MSG_KEY(id), JSON.stringify(msg))
      return res.json({ success: true })
    }

    /* ================= SHADOWBAN ================= */
    if (action === "shadowban" && admin) {
      await redis.hset(SHADOWBAN_KEY, body.target, "1")
      return res.json({ success: true })
    }

    if (action === "unshadowban" && admin) {
      await redis.hdel(SHADOWBAN_KEY, body.target)
      return res.json({ success: true })
    }

    return res
      .status(400)
      .json({ success: false, error: "Unknown action" })
  } catch (err) {
    console.error("CHAT ERROR:", err)
    return res
      .status(500)
      .json({ success: false, error: "Server error" })
  }
}
