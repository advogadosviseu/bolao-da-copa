// ============================================================
//  BOLÃO DA COPA — lógica da aplicação
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, APP_EDITION, SCORING } from "./config.js";

// ---- guarda contra config não preenchida -------------------
if (SUPABASE_URL.includes("COLE_AQUI")) {
  document.body.innerHTML =
    '<div style="font-family:system-ui;color:#f3efe2;background:#07140d;min-height:100vh;display:grid;place-items:center;padding:40px;text-align:center;line-height:1.6">' +
    "<div><h1 style='font-size:24px'>⚙️ Configuração pendente</h1>" +
    "<p>Edite <code>js/config.js</code> com a URL e a anon key do seu projeto Supabase.<br>" +
    "Veja o passo a passo no <code>README.md</code>.</p></div></div>";
  throw new Error("Configure js/config.js");
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- estado -------------------------------------------------
const state = {
  user: null,
  profile: null,
  matches: [],
  bets: new Map(),     // match_id -> bet
  stageFilter: "all",
};

// ---- atalhos DOM -------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

// ============================================================
//  BOOT
// ============================================================
init();

async function init() {
  $("#brandName").textContent = APP_NAME;
  $("#brandEdition").textContent = APP_EDITION;
  $("#footerYear").textContent = APP_EDITION;
  renderHeroScoring();
  wireAuthUI();
  wireNav();
  wireAdminForm();
  wireBulkImport();

  const { data: { session } } = await sb.auth.getSession();
  await onAuthChange(session);

  sb.auth.onAuthStateChange((_e, session) => onAuthChange(session));
}

function renderHeroScoring() {
  $("#heroScoring").innerHTML = SCORING
    .map((s) => `<li>${s.label} <b>${s.points} pts</b></li>`)
    .join("");
}

// ============================================================
//  AUTENTICAÇÃO
// ============================================================
function wireAuthUI() {
  // alterna abas login/cadastro
  $$(".auth-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      $$(".auth-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      const isLogin = tab.dataset.tab === "login";
      $("#loginForm").hidden = !isLogin;
      $("#signupForm").hidden = isLogin;
      setAuthMsg("");
    })
  );

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setAuthMsg("Entrando…");
    const { error } = await sb.auth.signInWithPassword({
      email: f.get("email").trim(),
      password: f.get("password"),
    });
    if (error) setAuthMsg(traduzErro(error.message), "error");
  });

  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setAuthMsg("Criando conta…");
    const { data, error } = await sb.auth.signUp({
      email: f.get("email").trim(),
      password: f.get("password"),
      options: { data: { display_name: f.get("display_name").trim() } },
    });
    if (error) { setAuthMsg(traduzErro(error.message), "error"); return; }
    if (data.session) {
      setAuthMsg("Conta criada! 🎉", "ok");
    } else {
      setAuthMsg("Conta criada! Confirme seu e-mail para entrar (verifique o spam).", "ok");
    }
  });

  $("#logoutBtn").addEventListener("click", () => sb.auth.signOut());
}

async function onAuthChange(session) {
  state.user = session?.user ?? null;

  if (!state.user) {
    $("#siteHeader").hidden = true;
    showView("auth");
    return;
  }

  // carrega o perfil (nome + admin)
  const { data: profile } = await sb
    .from("profiles").select("*").eq("id", state.user.id).single();
  state.profile = profile;

  $("#siteHeader").hidden = false;
  $("#userName").textContent = profile?.display_name ?? "Participante";
  $("#navAdmin").hidden = !profile?.is_admin;

  await loadMatchesAndBets();
  showView("matches");
}

function setAuthMsg(text, kind = "") {
  const el = $("#authMsg");
  el.textContent = text;
  el.className = "auth-msg " + kind;
}

function traduzErro(msg) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if (m.includes("already registered")) return "Este e-mail já tem conta. Tente entrar.";
  if (m.includes("password")) return "Senha inválida (mínimo 6 caracteres).";
  if (m.includes("email")) return "E-mail inválido.";
  return msg;
}

// ============================================================
//  NAVEGAÇÃO ENTRE VIEWS
// ============================================================
function wireNav() {
  $("#mainNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (btn) showView(btn.dataset.view);
  });
  $("#refreshRanking").addEventListener("click", loadRanking);
}

function showView(name) {
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  if (name === "ranking") loadRanking();
  if (name === "admin") renderAdminResults();
}

// ============================================================
//  JOGOS + PALPITES
// ============================================================
async function loadMatchesAndBets() {
  const [{ data: matches }, { data: bets }] = await Promise.all([
    sb.from("matches").select("*").order("kickoff", { ascending: true }),
    sb.from("bets").select("*").eq("user_id", state.user.id),
  ]);

  state.matches = matches ?? [];
  state.bets = new Map((bets ?? []).map((b) => [b.match_id, b]));
  renderStageFilter();
  renderMatches();
}

function renderStageFilter() {
  const stages = [...new Set(state.matches.map((m) => m.stage))];
  const chips = ['<button class="filter-chip is-active" data-stage="all">Todos</button>'];
  stages.forEach((s) =>
    chips.push(`<button class="filter-chip" data-stage="${esc(s)}">${esc(s)}</button>`)
  );
  const box = $("#stageFilter");
  box.innerHTML = stages.length > 1 ? chips.join("") : "";
  box.querySelectorAll(".filter-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.stageFilter = chip.dataset.stage;
      box.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("is-active", c === chip));
      renderMatches();
    })
  );
}

function renderMatches() {
  const list = $("#matchList");
  const items = state.matches.filter(
    (m) => state.stageFilter === "all" || m.stage === state.stageFilter
  );

  $("#matchesEmpty").hidden = state.matches.length > 0;
  list.innerHTML = items.map(matchCard).join("");

  // liga os botões de salvar
  items.forEach((m) => {
    const card = list.querySelector(`[data-match="${m.id}"]`);
    if (!card) return;
    const btn = card.querySelector(".save-bet");
    if (btn) btn.addEventListener("click", () => saveBet(m, card));
  });
}

function matchCard(m) {
  const locked = new Date(m.kickoff) <= new Date() || m.status !== "scheduled";
  const finished = m.status === "finished" && m.home_score != null;
  const bet = state.bets.get(m.id);

  const kickoffStr = fmtDate.format(new Date(m.kickoff));

  // bloco de placar (inputs ou placar final)
  let scoreBlock;
  if (finished) {
    scoreBlock = `
      <div class="final-score">
        <span>${m.home_score}</span><span class="fs-label">final</span><span>${m.away_score}</span>
      </div>`;
  } else {
    const hv = bet ? bet.home_pred : "";
    const av = bet ? bet.away_pred : "";
    scoreBlock = `
      <div class="score-inputs">
        <input type="number" min="0" max="30" class="in-home" value="${hv}" ${locked ? "disabled" : ""} aria-label="gols mandante" />
        <span class="score-x">×</span>
        <input type="number" min="0" max="30" class="in-away" value="${av}" ${locked ? "disabled" : ""} aria-label="gols visitante" />
      </div>`;
  }

  // rodapé: botão salvar, ou pontuação obtida
  let foot;
  if (finished && bet) {
    const pts = betPoints(bet.home_pred, bet.away_pred, m.home_score, m.away_score);
    const cls = pts === 10 ? "hit" : pts > 0 ? "partial" : "miss";
    foot = `<div class="match-foot"><span class="bet-points ${cls}">Seu palpite: ${bet.home_pred}×${bet.away_pred} · ${pts} pts</span></div>`;
  } else if (finished && !bet) {
    foot = `<div class="match-foot"><span class="bet-points miss">Você não palpitou neste jogo</span></div>`;
  } else if (locked) {
    foot = bet
      ? `<div class="match-foot"><span class="bet-points partial">Seu palpite: ${bet.home_pred}×${bet.away_pred}</span></div>`
      : `<div class="match-foot"><span class="bet-points miss">Apostas encerradas</span></div>`;
  } else {
    foot = `<div class="match-foot"><button class="save-bet ${bet ? "saved" : ""}">${bet ? "Palpite salvo ✓ · alterar" : "Salvar palpite"}</button></div>`;
  }

  return `
    <article class="match-card ${locked ? "locked" : ""} ${m.status === "live" ? "live" : ""}" data-match="${m.id}">
      <div class="match-meta">
        <span class="match-stage">${esc(m.stage)}</span>
        <span class="match-kickoff">${kickoffStr}</span>
      </div>
      <div class="match-teams">
        <div class="team">
          <span class="team-flag">${esc(m.home_flag || "🏳️")}</span>
          <span class="team-name">${esc(m.home_team)}</span>
        </div>
        ${scoreBlock}
        <div class="team">
          <span class="team-flag">${esc(m.away_flag || "🏳️")}</span>
          <span class="team-name">${esc(m.away_team)}</span>
        </div>
      </div>
      ${foot}
    </article>`;
}

async function saveBet(m, card) {
  const home = parseInt(card.querySelector(".in-home").value, 10);
  const away = parseInt(card.querySelector(".in-away").value, 10);
  if (Number.isNaN(home) || Number.isNaN(away) || home < 0 || away < 0) {
    toast("Preencha os dois placares.", true);
    return;
  }

  const row = {
    user_id: state.user.id,
    match_id: m.id,
    home_pred: home,
    away_pred: away,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from("bets")
    .upsert(row, { onConflict: "user_id,match_id" })
    .select()
    .single();

  if (error) {
    toast(error.message.includes("kickoff") || error.code === "42501"
      ? "Jogo já começou. Apostas encerradas." : "Erro ao salvar.", true);
    return;
  }
  state.bets.set(m.id, data);
  toast("Palpite salvo! ⚽");
  const btn = card.querySelector(".save-bet");
  if (btn) { btn.textContent = "Palpite salvo ✓ · alterar"; btn.classList.add("saved"); }
}

// pontuação no cliente (espelha a função SQL)
function betPoints(bh, ba, mh, ma) {
  if (mh == null || ma == null) return 0;
  if (bh === mh && ba === ma) return 10;
  const sb_ = Math.sign(bh - ba), sm = Math.sign(mh - ma);
  if (sb_ === sm && Math.abs(bh - ba) === Math.abs(mh - ma)) return 7;
  if (sb_ === sm) return 5;
  return 0;
}

// ============================================================
//  RANKING
// ============================================================
async function loadRanking() {
  const { data, error } = await sb.rpc("get_standings");
  const body = $("#rankingBody");
  const empty = $("#rankingEmpty");

  if (error) { body.innerHTML = ""; empty.hidden = false; empty.textContent = "Não foi possível carregar o ranking."; return; }

  const rows = (data ?? []).filter((r) => r.total_bets > 0 || r.points > 0);
  empty.hidden = rows.length > 0;
  $("#rankingTable").style.display = rows.length ? "" : "none";

  body.innerHTML = rows.map((r, i) => {
    const pos = i + 1;
    const me = r.user_id === state.user.id;
    const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : pos;
    return `
      <tr class="${me ? "is-me" : ""}">
        <td><span class="rank-pos ${pos <= 3 ? "medal" : ""}">${medal}</span></td>
        <td class="rank-name">${esc(r.display_name)}${me ? '<span class="you-tag">VOCÊ</span>' : ""}</td>
        <td class="col-num">${r.exact_hits}</td>
        <td class="col-num">${r.total_bets}</td>
        <td class="col-pts">${r.points}</td>
      </tr>`;
  }).join("");
}

// ============================================================
//  ADMIN
// ============================================================
function wireAdminForm() {
  $("#newMatchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = {
      stage: f.get("stage").trim(),
      home_team: f.get("home_team").trim(),
      away_team: f.get("away_team").trim(),
      home_flag: f.get("home_flag").trim() || null,
      away_flag: f.get("away_flag").trim() || null,
      kickoff: new Date(f.get("kickoff")).toISOString(),
    };
    const { error } = await sb.from("matches").insert(row);
    if (error) { setAdminMsg(error.message, "error"); return; }
    setAdminMsg("Jogo adicionado! ✓", "ok");
    e.target.reset();
    e.target.stage.value = "Fase de grupos";
    await loadMatchesAndBets();
    renderAdminResults();
  });
}

// ---- carga em lote -----------------------------------------
function wireBulkImport() {
  $("#bulkImportBtn").addEventListener("click", async () => {
    const lines = $("#bulkInput").value
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

    if (!lines.length) { showBulkLog([{ kind: "err", text: "Cole ao menos uma linha." }]); return; }

    const rows = [], log = [];
    lines.forEach((line, i) => {
      const r = parseBulkLine(line);
      if (r.error) log.push({ kind: "err", text: `Linha ${i + 1}: ${r.error}` });
      else rows.push(r.row);
    });

    if (!rows.length) { showBulkLog(log); return; }

    const btn = $("#bulkImportBtn");
    btn.disabled = true; btn.textContent = "Importando…";
    const { error } = await sb.from("matches").insert(rows);
    btn.disabled = false; btn.textContent = "Importar jogos";

    if (error) { showBulkLog([...log, { kind: "err", text: "Erro ao salvar: " + error.message }]); return; }

    log.unshift({ kind: "ok", text: `✓ ${rows.length} jogo(s) importado(s).` +
      (log.length ? ` ${log.length} linha(s) ignorada(s):` : "") });
    showBulkLog(log);
    $("#bulkInput").value = "";
    await loadMatchesAndBets();
    renderAdminResults();
  });

  $("#bulkInput").addEventListener("input", (e) => {
    const n = e.target.value.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length;
    $("#bulkCount").textContent = n ? `${n} linha(s)` : "";
  });
}

function parseBulkLine(line) {
  const parts = (line.includes("\t") ? line.split("\t") : line.split(";")).map((s) => s.trim());
  if (parts.length < 4) return { error: `precisa de 4 campos (achei ${parts.length}) → ${line}` };
  const [stage, home, away, dt, hflag, aflag] = parts;
  if (!home || !away) return { error: `time em branco → ${line}` };
  const iso = parseDateBR(dt);
  if (!iso) return { error: `data inválida "${dt}" (use DD/MM/AAAA HH:MM)` };
  return { row: {
    stage: stage || "Fase de grupos",
    home_team: home,
    away_team: away,
    home_flag: hflag || null,
    away_flag: aflag || null,
    kickoff: iso,
  }};
}

// aceita "DD/MM/AAAA HH:MM" (pt-BR) ou "AAAA-MM-DD HH:MM" (ISO)
function parseDateBR(s) {
  s = (s || "").trim();
  let y, mo, d, hh, mm, m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[:h](\d{2})$/))) {
    [d, mo, y, hh, mm] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  } else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/))) {
    [y, mo, d, hh, mm] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const dt = new Date(y, mo - 1, d, hh, mm);
  // rejeita datas que "transbordam" (ex.: 31/02 vira 03/03)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.toISOString();
}

function showBulkLog(entries) {
  const el = $("#bulkLog");
  el.hidden = false;
  el.innerHTML = entries.map((e) => `<span class="${e.kind}">${esc(e.text)}</span>`).join("\n");
}

function renderAdminResults() {
  const box = $("#adminResults");
  if (!state.matches.length) { box.innerHTML = '<p class="hint">Nenhum jogo cadastrado.</p>'; return; }

  box.innerHTML = state.matches.map((m) => `
    <div class="admin-result-row" data-match="${m.id}">
      <div class="arr-teams">${esc(m.home_team)} × ${esc(m.away_team)}
        <small>${esc(m.stage)} · ${fmtDate.format(new Date(m.kickoff))}</small>
      </div>
      <div class="arr-inputs">
        <input type="number" min="0" max="30" class="ar-home" value="${m.home_score ?? ""}" aria-label="placar mandante" />
        <span class="score-x">×</span>
        <input type="number" min="0" max="30" class="ar-away" value="${m.away_score ?? ""}" aria-label="placar visitante" />
      </div>
      <button data-id="${m.id}">Lançar</button>
    </div>`).join("");

  box.querySelectorAll("button[data-id]").forEach((btn) =>
    btn.addEventListener("click", () => saveResult(btn.dataset.id, btn.closest(".admin-result-row")))
  );
}

async function saveResult(id, row) {
  const home = parseInt(row.querySelector(".ar-home").value, 10);
  const away = parseInt(row.querySelector(".ar-away").value, 10);
  if (Number.isNaN(home) || Number.isNaN(away)) { setAdminMsg("Preencha o placar.", "error"); return; }

  const { error } = await sb.from("matches")
    .update({ home_score: home, away_score: away, status: "finished" })
    .eq("id", id);

  if (error) { setAdminMsg(error.message, "error"); return; }
  setAdminMsg("Resultado lançado! Ranking atualizado. ✓", "ok");
  await loadMatchesAndBets();
}

function setAdminMsg(text, kind = "") {
  const el = $("#adminMsg");
  el.textContent = text;
  el.className = "admin-msg " + kind;
  if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ""; } }, 4000);
}

// ============================================================
//  UTILIDADES
// ============================================================
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (isErr ? " err" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2600);
}
