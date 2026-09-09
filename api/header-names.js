export default function handler(req, res) {
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const names = Object.keys(req.headers || {}).sort();
  return res.status(200).json({ ok: true, headers: names });
}
