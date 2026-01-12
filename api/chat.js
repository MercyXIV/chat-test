// api/chat.js — Global chat with bounded history + moderation (FINAL)
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
const unwrap = (v) => {
  let x = v
  for (let i = 0; i < 8; i++) {
    if (x == null) return null
    if (Array.isArray(x)) { x = x[0]; continue }
    if (typeof x === "object" && x && "result" in x) { x = x.result; continue }
    break
  }
  return x
}

function safeParse(v) {
  const x = unwrap(v)
  if (!x) return null
  if (typeof x === "object") return x
  try { return JSON.parse(x) } catch { return null }
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))
const normName = (s) => String(s || "").trim().slice(0, 20)
const normText = (s) => String(s || "").trim().slice(0, 400)
const rand = (n = 8) => [...Array(n)].map(() => Math.random().toString(36)[2]).join("")
const msgIdGen = () => `msg_${Date.now()}_${rand()}`

/* ---------------- Redis Keys ---------------- */
const FEED_KEY = "standalone_chat_feed_v1"
const MSG_KEY = (id) => `standalone_chat_msg:${id}`
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

    /* ---------- LIST ---------- */
    if (action === "list") {
      const limit = clamp(
        Number(body.limit || CLIENT_MAX_MESSAGES),
        1,
        CLIENT_MAX_MESSAGES
      )

      const ids = (await redis.lrange(FEED_KEY, 0, limit - 1)) || []
      if (!ids.length) {
        return res.status(200).json({ success: true, messages: [] })
      }

      const pipe = redis.pipeline()
      ids.forEach(id => pipe.get(MSG_KEY(id)))
      const raw = await pipe.exec()

      const messages = []
      const missing = []

      ids.forEach((id, i) => {
        const msg = safeParse(raw[i])
        if (!msg || !msg.id) missing.push(id)
        else messages.push(msg)
      })

      if (missing.length) {
        const p2 = redis.pipeline()
        missing.forEach(id => p2.lrem(FEED_KEY, 0, id))
        await p2.exec()
      }

      return res.status(200).json({ success: true, messages })
    }

    /* ---------- CREATE ---------- */
    if (action === "create") {
      const name = normName(body.name)
      const text = normText(body.text)
      const replyTo = body.replyTo ? String(body.replyTo) : null

      if (!name || !text) return res.status(400).json({ success: false })
      if (await redis.get(TIMEOUT_KEY(name))) {
        return res.status(403).json({ success: false, error: "Timed out" })
      }
      if (await redis.get(COOLDOWN_KEY(name))) {
        return res.status(429).json({ success: false })
      }

      let reply = null
      if (replyTo) {
        const parent = safeParse(await redis.get(MSG_KEY(replyTo)))
        if (parent && !parent.deleted) {
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
        .set(MSG_KEY(msg.id), JSON.stringify(msg))
        .lpush(FEED_KEY, msg.id)
        .ltrim(FEED_KEY, 0, SERVER_MAX_MESSAGES - 1)
        .exec()

      return res.status(200).json({ success: true, message: msg })
    }

    /* ---------- EDIT ---------- */
    if (action === "edit") {
      const { id, name, text } = body
      const msg = safeParse(await redis.get(MSG_KEY(id)))
      if (!msg || msg.name !== name) {
        return res.status(403).json({ success: false })
      }

      msg.text = normText(text)
      msg.editedAt = Date.now()
      await redis.set(MSG_KEY(id), JSON.stringify(msg))
      return res.status(200).json({ success: true })
    }

    /* ---------- DELETE ---------- */
    if (action === "delete") {
      const { id, name } = body
      const msg = safeParse(await redis.get(MSG_KEY(id)))
      if (!msg) return res.status(404).json({ success: false })

      if (msg.name !== name && !isAdmin(body)) {
        return res.status(403).json({ success: false })
      }

      msg.deleted = true
      msg.text = "[message deleted]"
      await redis.set(MSG_KEY(id), JSON.stringify(msg))
      return res.status(200).json({ success: true })
    }

    /* ---------- ADMIN: TIMEOUT ---------- */
    if (action === "admin_timeout") {
      if (!isAdmin(body)) return res.status(403).json({ success: false })
      const target = normName(body.target)
      const minutes = clamp(Number(body.minutes || 5), 1, 1440)
      await redis.set(TIMEOUT_KEY(target), "1", { ex: minutes * 60 })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ success: false })
  } catch {
    return res.status(500).json({ success: false })
  }
    }
