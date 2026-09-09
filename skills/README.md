# Skills do projeto ATON

## `/atoninnovex`

Definição: `skills/atoninnovex/SKILL.md`

Use esta skill para consultas somente leitura ao ATON da Innovex. O fluxo oficial utiliza a rota segura da Vercel `/api/direct-read`, autenticada por OIDC da Vercel, sem MCP e sem exposição do token do ATON.

Ao receber `/atoninnovex`, carregar e seguir `skills/atoninnovex/SKILL.md` como fonte de verdade para a integração da Innovex.
