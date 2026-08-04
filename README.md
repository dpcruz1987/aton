# Aton Innovex — conector somente leitura

Função Vercel que permite apenas operações de consulta previamente autorizadas.

## Segurança

- O upstream sempre recebe `GET`; métodos de escrita são rejeitados.
- Não existe proxy de caminho livre.
- Token e URL são variáveis protegidas da Vercel.
- A lista `ATON_READ_OPERATIONS` mapeia nomes públicos para caminhos internos.
- Respostas não são armazenadas em cache.

## Variáveis obrigatórias

- `ATON_BASE_URL`
- `ATON_TOKEN`
- `ATON_READ_OPERATIONS` (JSON: `{ "produto": "/rota/de/consulta" }`)
- `ATON_TOKEN_HEADER` (opcional; padrão `Authorization`)
- `ATON_TOKEN_PREFIX` (opcional; padrão `Bearer `)
