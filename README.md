# Aton Innovex — conector somente leitura

Função Vercel que permite apenas operações de consulta previamente autorizadas.

## Segurança

- O upstream recebe `POST` apenas para as consultas documentadas; métodos de escrita são rejeitados.
- Não existe proxy de caminho livre.
- Token e URL são variáveis protegidas da Vercel.
- A lista `ATON_READ_OPERATIONS` mapeia nomes públicos para caminhos internos.
- Respostas não são armazenadas em cache.

## Variáveis obrigatórias

- `ATON_BASE_URL`
- `ATON_TOKEN`
- `ATON_READ_OPERATIONS` (JSON: `{ "produto": "/rota/de/consulta" }`)
- `ATON_READ_PARAMETERS` (JSON: `{ "produto": ["codigo", "ean"] }`)
- `ATON_CONNECTOR_TOKEN` (segredo usado pelo Codex para acessar o conector)
- `ATON_TOKEN_HEADER` (opcional; padrão `Authorization`)
- `ATON_TOKEN_PREFIX` (opcional; padrão `Bearer `)

## Conectar ao Codex

O endpoint `/mcp` implementa MCP Streamable HTTP e expõe uma ferramenta somente
leitura para cada chave de `ATON_READ_OPERATIONS`. Configure o cliente para enviar
`Authorization: Bearer <ATON_CONNECTOR_TOKEN>`.

Endpoint de produção:

```toml
[mcp_servers.aton]
url = "https://aton-innovex-readonly.vercel.app/mcp"
bearer_token_env_var = "ATON_CONNECTOR_TOKEN"
```

Cada atualização da branch `main` é publicada automaticamente pela integração GitHub–Vercel.

Antes de conectar, confirme `configured: true` em `GET /health`. O endpoint de
saúde não retorna tokens nem caminhos internos.

