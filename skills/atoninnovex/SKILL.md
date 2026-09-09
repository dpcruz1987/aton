# /atoninnovex

Skill de acesso completo à API ATON da Innovex.

## Objetivo

Quando o usuário escrever `/atoninnovex` ou pedir qualquer operação no ATON da Innovex, usar o backend real da Innovex. Não responder de memória quando a informação depender do ATON e não pedir novamente credenciais já configuradas no backend.

## Backend oficial

Projeto Vercel: `aton-innovex-readonly`.

Rotas seguras:

- Consultas comuns validadas: `https://aton-innovex-readonly.vercel.app/api/direct-read`
- Acesso completo à API: `https://aton-innovex-readonly.vercel.app/api/full-access`

Autenticação das rotas: OIDC assinado pela Vercel. Não usar MCP para este fluxo. Nunca colocar o token do ATON em URL, resposta, logs ou código em claro.

API oficial chamada pelo backend:

`https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp`

## Capacidade total

A rota `/api/full-access` permite encaminhar operações documentadas da API ATON usando os métodos:

- GET
- POST
- PUT
- PATCH
- DELETE

O caminho deve sempre ser relativo à base oficial do ATON, começar com `/` e nunca aceitar host arbitrário. O corpo JSON é enviado ao backend codificado em base64url e o backend o repassa ao ATON.

Parâmetros de query do ATON podem ser enviados pelo backend usando prefixo `qp_`.

## Regra de segurança para escrita

A integração tem capacidade técnica de escrita, mas nenhuma alteração deve ser executada por iniciativa própria.

- Leitura/consulta: pode executar diretamente quando solicitada.
- Criação, edição, exclusão, baixa, atualização de estoque, alteração de preço, alteração de cadastro, pedido, financeiro ou qualquer outra mutação: executar somente quando o usuário pedir explicitamente a alteração.
- Antes de uma mutação, validar endpoint, método e payload com documentação oficial, resposta anterior do ATON ou evidência concreta. Nunca adivinhar campo obrigatório.
- Se o usuário apenas perguntar "consegue alterar?", explicar que consegue, mas não executar até haver pedido explícito da mudança.
- Depois de mutações, consultar novamente o recurso quando possível para confirmar o resultado.

## Operações de leitura já validadas

### products
Endpoint direto: `/produtos/listagemgeral`
Parâmetros: `offset`, `limit`.

### product_search
Endpoint direto: `/produtos/listagemgeral`
Parâmetros: `codigo_interno`, `ean`, `descricao`, `offset`, `limit`.

### product_stock
Endpoint direto: `/produtos/consultarestoque`
Parâmetro: `produtos`.

Outras operações documentadas podem ser usadas pela rota de acesso completo, mesmo que ainda não tenham um atalho nominal nesta skill.

## Regras de integridade

1. Sempre consultar o ATON quando a resposta depender de cadastro, custo, preço, estoque, pedido, logística, financeiro ou outro dado atual da Innovex.
2. Nunca inventar produto, saldo, preço, custo, EAN, NCM, descrição, código, pedido, título financeiro ou fabricante.
3. Se um campo não vier na resposta, informar `não retornado` em vez de assumir zero ou preencher por inferência.
4. Preservar zeros à esquerda em códigos e documentos.
5. Distinguir `codigo_aton`, `cod_interno`, `codigo_fabricante` e `ean`.
6. Separar claramente `valor_custo`, `valor_custo_medio`, `valores_venda` e estoque.
7. Respeitar paginação; não presumir que a primeira página contém todos os registros.
8. Nunca exibir, repetir ou solicitar o token do ATON se o backend estiver funcionando.
9. Nunca usar um endpoint de escrita sem antes validar sua função e payload.
10. Nunca transformar erro da API em sucesso presumido.

## Comportamento esperado para `/atoninnovex`

Se o usuário escrever apenas `/atoninnovex`, informar de forma curta que o acesso à API ATON da Innovex está pronto para consulta e operações autorizadas.

Se o usuário escrever `/atoninnovex <consulta>`, executar a consulta real imediatamente quando a ferramenta Vercel estiver disponível.

Se o usuário pedir uma alteração explícita, localizar e validar o endpoint correto, executar a mutação pela rota `full-access` e conferir o resultado.

Exemplos de leitura:

- `/atoninnovex consulte o produto 311326324`
- `/atoninnovex procure DS-2CD1027G2H-LIU`
- `/atoninnovex veja o estoque desse produto`
- `/atoninnovex consulte pedidos emitidos hoje`
- `/atoninnovex veja contas a receber`

Exemplos de escrita, somente mediante pedido explícito:

- `/atoninnovex altere a descrição do produto X para Y`
- `/atoninnovex atualize o campo Z do produto X`
- `/atoninnovex execute a operação documentada PUT /... com estes dados ...`

## Resultado de validação

Fluxo de leitura validado em 09/09/2026 com resposta real do ATON `status: sucesso`, retornando 1.637 produtos na listagem da Innovex.

A rota de acesso completo foi adicionada em 09/09/2026 para permitir uso de toda a superfície documentada da API ATON, incluindo métodos de escrita sob solicitação explícita do usuário.

## Segurança

- Sem MCP neste fluxo.
- Token da Innovex não consta neste arquivo.
- O token permanece criptografado no backend e é reconstruído apenas em tempo de execução.
- O endpoint de acesso completo só aceita chamadas autenticadas pelo OIDC da Vercel e só encaminha caminhos relativos à base oficial do ATON.
- Não criar endpoints temporários de diagnóstico para operações normais.
