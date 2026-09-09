function decodePart(part){
  try { return JSON.parse(Buffer.from(part.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')); }
  catch { return null; }
}
export default function handler(req, res) {
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const names = Object.keys(req.headers || {}).sort();
  const token = String(req.headers?.['x-vercel-oidc-token'] || '');
  const parts = token.split('.');
  const header = parts.length === 3 ? decodePart(parts[0]) : null;
  const payload = parts.length === 3 ? decodePart(parts[1]) : null;
  return res.status(200).json({
    ok: true,
    headers: names,
    oidc: token ? {
      present: true,
      header,
      payload: payload ? {
        iss: payload.iss ?? null,
        sub: payload.sub ?? null,
        aud: payload.aud ?? null,
        exp: payload.exp ?? null,
        iat: payload.iat ?? null,
        owner: payload.owner ?? null,
        project: payload.project ?? null,
        environment: payload.environment ?? null
      } : null
    } : { present: false }
  });
}
