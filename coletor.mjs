// Coletor da apuração do 1º turno de 2026 para o Radar 26.
//
// Consulta os arquivos públicos de apuração do TSE (Brasil + 27 UFs) e, a cada geração nova do
// TSE, guarda um snapshot compacto com os votos de Lula e Flávio em `dados/<eleição>.json`.
// O TSE não guarda histórico: este arquivo é o histórico. Sem dependências (Node 20+).
//
//   node coletor.mjs                      # laço de DURACAO_MIN minutos, consultando a cada INTERVALO_S s
//   DURACAO_MIN=1 SEM_PUSH=1 node coletor.mjs   # teste local, sem git
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const ELEICAO = process.env.ELEICAO ?? "6257";
const TSE = "https://resultados.tse.jus.br/oficial/ele2026";
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];
export const TERRITORIOS = ["BR", ...UFS];

/** Arquivo unificado de Presidente: `…/6257/dados/sp/sp-c0001-e006257-u.json`. */
export function urlTse(territorio, eleicao = ELEICAO) {
  const abr = territorio.toLowerCase();
  return `${TSE}/${eleicao}/dados/${abr}/${abr}-c0001-e${eleicao.padStart(6, "0")}-u.json`;
}

/* ───────────────────────────── Leitura do JSON do TSE ───────────────────────────── */

/** Percentual em texto: "45,31", "59,351118968" (vírgula) ou "45.31". */
function percentual(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

/** Contagem em texto: "3393110" ou "3.393.110". */
function inteiro(v) {
  const s = String(v ?? "").replace(/\D/g, "");
  return s ? Number(s) : null;
}

/**
 * Extrai de um arquivo do TSE o que interessa: instante de geração (`t`, ms; `dg`/`hg` são
 * horário de Brasília, UTC−3), % de seções totalizadas (`pst`), votos de Lula (nº 13) e de
 * Flávio (nº 22), votos de todos os candidatos (`v`) e se a totalização acabou (`fim`).
 */
export function lerArquivo(json) {
  const cargos = Array.isArray(json?.carg) ? json.carg : [];
  const cargo = cargos.find((c) => String(c?.cd) === "1") ?? cargos[0];
  if (!cargo) return null;

  const candidatos = [];
  for (const agr of cargo.agr ?? []) {
    for (const par of agr.par ?? []) candidatos.push(...(par.cand ?? []));
    candidatos.push(...(agr.cand ?? []));
  }
  if (!candidatos.length) return null;

  const votos = (c) => inteiro(c?.vap) ?? 0;
  const lula = candidatos.find((c) => String(c.n) === "13");
  const flavio = candidatos.find((c) => String(c.n) === "22");
  const s = json.s ?? {};
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(json.dg ?? "").trim());
  const h = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(json.hg ?? "").trim());

  return {
    t: d && h ? Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1] + 3, +h[2], +h[3]) : null,
    pst: percentual(s.pstn) ?? percentual(s.pst),
    l: lula ? votos(lula) : null,
    f: flavio ? votos(flavio) : null,
    v: candidatos.reduce((acc, c) => acc + votos(c), 0),
    fim: json.tf === "s",
  };
}

/* ───────────────────────────────────── Snapshot ───────────────────────────────────── */

const arredonda = (n, casas) => Math.round(n * 10 ** casas) / 10 ** casas;

/**
 * Um snapshot: `{ t, c, d }`, onde `t` é a geração mais recente do TSE entre os arquivos lidos,
 * `c` o instante da coleta e `d` mapeia cada território a
 * `[% de seções totalizadas, votos de Lula, votos de Flávio, votos de todos os candidatos]`.
 * Território que não pôde ser lido simplesmente não aparece. `null` se nada serve.
 */
export function montarSnapshot(lidos, agora = Date.now()) {
  const d = {};
  let t = null;
  for (const [territorio, r] of Object.entries(lidos)) {
    if (!r || r.pst === null || r.l === null || r.f === null) continue;
    d[territorio] = [arredonda(r.pst, 4), r.l, r.f, r.v];
    if (r.t !== null && (t === null || r.t > t)) t = r.t;
  }
  return t === null || !Object.keys(d).length ? null : { t, c: agora, d };
}

/** Só entra snapshot de uma geração do TSE mais nova que a última guardada. */
export const deveAnexar = (ultimo, snapshot) => Boolean(snapshot) && (!ultimo || snapshot.t > ultimo.t);

/** A totalização acabou: o TSE marcou `tf` no Brasil e nenhuma seção ficou para trás. */
export const encerrou = (br) => Boolean(br?.fim) && (br.pst ?? 0) >= 99.99;

/** JSON válido com um snapshot por linha, para o diff do git ficar legível. */
export function serializar(doc) {
  const { snapshots, ...resto } = doc;
  const cabecalho = JSON.stringify(resto).slice(0, -1);
  return `${cabecalho},"snapshots":[\n${snapshots.map((s) => JSON.stringify(s)).join(",\n")}\n]}\n`;
}

/* ──────────────────────────────────────── Coleta ──────────────────────────────────────── */

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}Z]`, ...args);
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function buscar(territorio, timeoutMs = 15_000) {
  const controle = new AbortController();
  const temporizador = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resposta = await fetch(urlTse(territorio), {
      signal: controle.signal,
      headers: { "user-agent": "radar-eleitoral-26-coletor (+https://github.com/dinheirodevolta/radar-eleitoral-26-apuracao)" },
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const lido = lerArquivo(await resposta.json());
    if (!lido) throw new Error("formato inesperado");
    return lido;
  } finally {
    clearTimeout(temporizador);
  }
}

/** Uma rodada: Brasil + 27 UFs em paralelo. Falha pontual não derruba as demais. */
async function rodada() {
  const lidos = {};
  const erros = {};
  await Promise.all(
    TERRITORIOS.map(async (t) => {
      try {
        lidos[t] = await buscar(t);
      } catch (e) {
        erros[t] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return { lidos, erros };
}

function git(...args) {
  return spawnSync("git", args, { stdio: "inherit" }).status === 0;
}

/** Commit e push de `dados/`. Se o push for recusado, tenta uma vez depois de `pull --rebase`. */
function publicar(mensagem) {
  git("add", "dados");
  if (spawnSync("git", ["diff", "--cached", "--quiet"]).status === 0) return; // nada mudou
  if (!git("commit", "-m", mensagem)) return log("commit falhou");
  if (git("push")) return log("publicado:", mensagem);
  if (git("pull", "--rebase") && git("push")) return log("publicado (após rebase):", mensagem);
  log("push falhou; segue coletando e tenta de novo na próxima");
}

async function main() {
  const duracaoMin = Number(process.env.DURACAO_MIN ?? 330);
  const intervaloS = Number(process.env.INTERVALO_S ?? 60);
  const publicarACadaS = Number(process.env.PUSH_A_CADA_S ?? 180);
  const semPush = process.env.SEM_PUSH === "1";
  const arquivo = `dados/${ELEICAO}.json`;

  await mkdir("dados", { recursive: true });
  const doc = existsSync(arquivo)
    ? JSON.parse(await readFile(arquivo, "utf8"))
    : { eleicao: ELEICAO, formato: 1, encerrado: false, snapshots: [] };
  if (doc.encerrado) return log("totalização já encerrada; nada a coletar");

  const fim = Date.now() + duracaoMin * 60_000;
  let pendente = false;
  let ultimaPublicacao = Date.now();
  let rodadasLidas = 0;

  const salvar = async () => {
    await writeFile(arquivo, serializar(doc));
    if (!semPush) publicar(`dados: ${doc.snapshots.length} snapshots`);
    pendente = false;
    ultimaPublicacao = Date.now();
  };

  while (true) {
    const { lidos, erros } = await rodada();
    const n = Object.keys(lidos).length;
    if (n) rodadasLidas++;
    const falhas = Object.keys(erros);
    if (falhas.length) log(`${falhas.length} território(s) sem leitura:`, falhas.slice(0, 5).map((t) => `${t} ${erros[t]}`).join("; "));

    const snapshot = montarSnapshot(lidos);
    if (deveAnexar(doc.snapshots.at(-1), snapshot)) {
      doc.snapshots.push(snapshot);
      pendente = true;
      const br = snapshot.d.BR;
      log(`snapshot #${doc.snapshots.length}: TSE ${new Date(snapshot.t).toISOString().slice(11, 19)}Z`, br ? `BR ${br[0]}% | Lula ${br[1]} | Flávio ${br[2]}` : "(sem BR)");
    }
    if (encerrou(lidos.BR)) {
      doc.encerrado = true;
      pendente = true;
      log("totalização encerrada no Brasil");
    }

    const acabou = doc.encerrado || Date.now() + intervaloS * 1000 > fim;
    if (pendente && (acabou || Date.now() - ultimaPublicacao >= publicarACadaS * 1000)) await salvar();
    if (acabou) break;
    await dormir(intervaloS * 1000);
  }

  if (!rodadasLidas) {
    console.error("nenhuma rodada conseguiu ler o TSE");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
