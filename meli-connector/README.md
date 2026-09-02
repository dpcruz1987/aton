# Mercado Livre MCP — Global / Innovex

Conector privado para uso no ChatGPT. Mantém as credenciais do Mercado Livre fora
das conversas, renova o OAuth automaticamente e separa as contas por `account`.

## Variáveis obrigatórias

- `APP_BASE_URL`: URL pública sem barra final.
- `MCP_SIGNING_SECRET`: segredo aleatório com no mínimo 32 bytes.
- `MCP_PASSWORD_HASH`: SHA-256 hexadecimal da senha usada para vincular o app no ChatGPT.
- `MELI_CLIENT_ID`: ID da aplicação Mercado Livre.
- `MELI_CLIENT_SECRET`: segredo da aplicação Mercado Livre.
- `TOKEN_ENCRYPTION_KEY`: 64 caracteres hexadecimais (32 bytes).
- `BLOB_READ_WRITE_TOKEN`: injetado por um Vercel Blob privado.

## Rotas

- `/mcp`: MCP Streamable HTTP, protegido por OAuth 2.1 + PKCE.
- `/oauth/authorize`, `/oauth/token`, `/oauth/register`: autorização do ChatGPT.
- `/meli/connect?account=global|innovex`: inicia o OAuth do Mercado Livre.
- `/meli/callback`: recebe e armazena os tokens rotativos.
- `/health`: não expõe dados nem credenciais.

Nunca grave tokens no GitHub, logs ou respostas das ferramentas.
