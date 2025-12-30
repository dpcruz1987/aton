import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ====== CONFIGURE AQUI ======
// Coloque a BASE_URL real do ATON:
const ATON_BASE_URL = process.env.ATON_BASE_URL || "https://SEU_ATON_BASE_URL_AQUI";
// Guarde o token no .env (RECOMENDADO)
const ATON_TOKEN = process.env.ATON_TOKEN || "COLE_SEU_TOKEN_AQUI";

// Ajuste conforme o Postman:
// exemplo: Authorization: Bearer <token>
const TOKEN_HEADER = process.env.ATON_TOKEN_HEADER || "Authorization";
const TOKEN_PREFIX = process.env.ATON_TOKEN_PREFIX || "Bearer ";

// ===========================

function atonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    [TOKEN_HEADER]: `${TOKEN_PREFIX}${ATON_TOKEN}`,
    ...extra,
  };
}

// Proxy genérico: repassa qualquer rota /api/* para o ATON
app.all("/api/*", async (req, res) => {
  try {
    const path = req.originalUrl.replace(/^\/api/, "");
    const url = `${ATON_BASE_URL}${path}`;

    const options = {
      method: req.method,
      headers: atonHeaders(),
    };

    // não manda body em GET/HEAD
    if (!["GET", "HEAD"].includes(req.method)) {
      options.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(url, options);
    const text = await upstream.text();

    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro no proxy", error: String(err?.message || err) });
  }
});

app.listen(3000, () => console.log("Proxy rodando em http://localhost:3000"));
