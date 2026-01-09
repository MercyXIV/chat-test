export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    method: req.method,
    time: Date.now(),
  })
}
