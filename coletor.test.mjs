// node --test
import assert from "node:assert/strict";
import { test } from "node:test";
import { deveAnexar, encerrou, lerArquivo, montarSnapshot, serializar, urlTse } from "./coletor.mjs";

// Arquivo no formato do TSE (eleição 6257): carg > agr > par > cand, com `s` no topo.
function arquivo({ l, f, outros = 0, pstn = "12,5", tf = "n", dg = "04/10/2026", hg = "18:00:00" }) {
  const cand = (n, vap) => ({ n, vap: String(vap), pvapn: "0,000000000" });
  return {
    tf, dg, hg,
    carg: [{ cd: "1", agr: [
      { par: [{ cand: [cand("13", l)] }] },
      { par: [{ cand: [cand("22", f)] }] },
      { par: [{ cand: [cand("55", outros)] }] },
    ] }],
    s: { pst: "12,50", pstn },
  };
}

test("urlTse monta o endereço do arquivo unificado de Presidente", () => {
  assert.equal(urlTse("SP"), "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp-c0001-e006257-u.json");
  assert.equal(urlTse("BR", "6258"), "https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json");
});

test("lerArquivo lê votos, % de seções e o instante do TSE (horário de Brasília)", () => {
  const r = lerArquivo(arquivo({ l: 1000, f: 800, outros: 200, pstn: "12,345678901" }));
  assert.deepEqual({ l: r.l, f: r.f, v: r.v, pst: r.pst, fim: r.fim }, { l: 1000, f: 800, v: 2000, pst: 12.345678901, fim: false });
  assert.equal(new Date(r.t).toISOString(), "2026-10-04T21:00:00.000Z");
});

test("lerArquivo devolve null para o que não é um arquivo de apuração", () => {
  for (const lixo of [null, {}, { carg: [] }, { carg: [{ cd: "1", agr: [] }] }]) assert.equal(lerArquivo(lixo), null);
});

test("montarSnapshot usa a geração mais recente e ignora território sem leitura", () => {
  const a = lerArquivo(arquivo({ l: 10, f: 5, hg: "18:00:00" }));
  const b = lerArquivo(arquivo({ l: 20, f: 15, hg: "18:00:30" }));
  const s = montarSnapshot({ BR: a, SP: b, MG: undefined }, 123);
  assert.equal(s.t, b.t);
  assert.equal(s.c, 123);
  assert.deepEqual(Object.keys(s.d).sort(), ["BR", "SP"]);
  assert.deepEqual(s.d.SP, [12.5, 20, 15, 35]);
  assert.equal(montarSnapshot({}), null);
});

test("deveAnexar só aceita geração mais nova do TSE", () => {
  const s = (t) => ({ t, c: 0, d: { BR: [1, 1, 1, 1] } });
  assert.equal(deveAnexar(undefined, s(5)), true);
  assert.equal(deveAnexar(s(5), s(6)), true);
  assert.equal(deveAnexar(s(5), s(5)), false);
  assert.equal(deveAnexar(s(5), s(4)), false);
  assert.equal(deveAnexar(s(5), null), false);
});

test("encerrou exige o fim marcado pelo TSE e todas as seções totalizadas", () => {
  assert.equal(encerrou({ fim: true, pst: 100 }), true);
  assert.equal(encerrou({ fim: true, pst: 99.5 }), false);
  assert.equal(encerrou({ fim: false, pst: 100 }), false);
  assert.equal(encerrou(undefined), false);
});

test("serializar gera JSON válido com um snapshot por linha", () => {
  const doc = { eleicao: "6257", formato: 1, encerrado: false, snapshots: [{ t: 1, c: 2, d: { BR: [1, 2, 3, 4] } }, { t: 5, c: 6, d: {} }] };
  const texto = serializar(doc);
  assert.deepEqual(JSON.parse(texto), doc);
  assert.equal(texto.trim().split("\n").length, 4);
  assert.deepEqual(JSON.parse(serializar({ ...doc, snapshots: [] })).snapshots, []);
});
