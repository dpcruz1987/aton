# /atoninnovex

Skill de consulta somente leitura ao ATON da Innovex.

## Objetivo

Quando o usuário escrever `/atoninnovex` ou pedir consulta ao ATON da Innovex, priorizar consulta real ao backend da Innovex em vez de responder de memória, inventar dados ou pedir para o usuário repetir credenciais já configuradas no backend.

## Backend oficial

Projeto Vercel: `aton-innovex-readonly`

Rota segura validada:

`https://aton-innovex-readonly.vercel.app/api/direct-read`

Autenticação da rota: OIDC assinado pela própria Vercel. Não usar MCP para este fluxo. Não colocar token do ATON em URL, texto da resposta, logs ou código em claro.

A rota chama diretamente a API oficial do ATON:

`https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp`

## Operações validadas atualmente

### products
Usar para listar produtos.

Endpoint ATON direto: `/produtos/listagemgeral`

Parâmetros aceitos quando aplicável: `offset`, `limit`.

### product_search
Usar para localizar produto por código interno, EAN ou descrição.

Endpoint ATON direto: `/produtos/listagemgeral`

Parâmetros aceitos quando aplicável: `codigo_interno`, `ean`, `descricao`, `offset`, `limit`.

### product_stock
Usar para consultar estoque de produto.

Endpoint ATON direto: `/produtos/consultarestoque`

Parâmetro aceito quando aplicável: `produtos`.

## Regras de execução

1. Sempre consultar o ATON quando a resposta depender de cadastro, custo, preço, estoque ou outro dado atual da Innovex.
2. Nunca inventar produto, saldo, preço, custo, EAN, NCM, descrição, código ou fabricante.
3. Se a API retornar `status: sucesso`, considerar os dados retornados como fonte autoritativa do ATON para aquela consulta.
4. Se um campo não vier na resposta, informar `não retornado` em vez de assumir zero ou preencher por inferência.
5. Preservar zeros à esquerda em códigos e documentos.
6. Distinguir `codigo_aton`, `cod_interno`, `codigo_fabricante` e `ean`.
7. Separar claramente `valor_custo`, `valor_custo_medio` e `valores_venda`.
8. Para paginação de listagens, usar `offset` e `limit`; não presumir que a primeira página contém todos os produtos.
9. Não usar rotas de escrita nesta skill.
10. Nunca exibir, repetir ou solicitar o token do ATON se o backend já estiver funcionando.

## Comportamento esperado para `/atoninnovex`

Se o usuário escrever apenas `/atoninnovex`, responder de forma curta que a consulta ao ATON da Innovex está pronta e pedir o objeto da consulta, sem alegar resultado ainda não consultado.

Se o usuário escrever `/atoninnovex <consulta>`, executar a consulta real imediatamente quando a ferramenta Vercel estiver disponível.

Exemplos:

- `/atoninnovex consulte o produto 311326324`
- `/atoninnovex procure DS-2CD1027G2H-LIU`
- `/atoninnovex veja o estoque desse produto`
- `/atoninnovex liste produtos Hikvision`

## Resultado de validação

Fluxo validado em 09/09/2026 com resposta real do ATON `status: sucesso`, retornando 1.637 produtos na listagem da Innovex.

Exemplo real usado apenas para validar o conector: `311326324` — `CAMERA IP BULLET HIKVISION DS-2CD1027G2H-LIU(4MM) 2MP COLORVU HYBRID LIGHT AUDIO`.

Este exemplo não deve ser usado como resposta futura sem nova consulta ao ATON.

## Segurança

- Somente leitura.
- Sem MCP neste fluxo.
- Token da Innovex não deve constar neste arquivo.
- O segredo é resolvido no backend e nunca deve ser reproduzido ao usuário.
- Não criar endpoints temporários de diagnóstico para uma consulta normal.
