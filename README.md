# Radar 26 — histórico da apuração

Histórico da apuração do 1º turno presidencial de 2026 (Lula × Flávio), coletado a cada minuto dos arquivos públicos de apuração do TSE para o [Radar 26](https://radar-eleitoral-26.lovable.app). O TSE publica só o total parcial mais recente e não guarda histórico; este repositório guarda.

> **A fonte oficial é o TSE** (`resultados.tse.jus.br`). Estes arquivos são uma cópia não oficial, defasada em alguns minutos. Não são projeção do resultado final.

## Dados

`dados/6257.json` — 1º turno (eleição 6257). Um snapshot por linha, em ordem cronológica:

```json
{"eleicao":"6257","formato":1,"encerrado":false,"snapshots":[
{"t":1791148512000,"c":1791148530000,"d":{"BR":[12.3456,5123456,4812345,9500000],"SP":[...],...}}
]}
```

| Campo | Significado |
| --- | --- |
| `t` | geração mais recente do TSE entre os arquivos lidos (ms desde 1970; `dg`/`hg` do TSE, horário de Brasília) |
| `c` | instante da coleta (ms) |
| `d` | território (`BR` e as 27 UFs) → `[% de seções totalizadas, votos de Lula, votos de Flávio, votos de todos os candidatos]` |
| `encerrado` | a totalização acabou (`tf` = "s" no Brasil e 100% das seções) |

Só entra snapshot quando o TSE gerou arquivos novos, e um território que não pôde ser lido numa rodada simplesmente não aparece nela. Lula é o candidato nº 13 e Flávio, o nº 22.

Para ler de um navegador: `https://raw.githubusercontent.com/dinheirodevolta/radar-eleitoral-26-apuracao/main/dados/6257.json` (CORS aberto; o GitHub guarda em cache por cerca de 5 minutos).

## Como roda

[`coletar.yml`](.github/workflows/coletar.yml) inicia um laço de até 330 minutos que consulta o TSE a cada 60 s e publica os snapshots a cada 3 minutos. Ele é disparado à mão (`gh workflow run coletar.yml`) e há uma execução agendada a cada 30 minutos como rede de segurança. Quando a totalização encerra, o coletor sai na hora. Não usa segredos nem dependências: só `coletor.mjs` (Node 20+) e `GITHUB_TOKEN`.

```sh
node --test                                    # testes
DURACAO_MIN=1 SEM_PUSH=1 node coletor.mjs      # teste local, sem git
```
