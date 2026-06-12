-- ============================================================
--  BOLÃO DA COPA — Receitas de administração (Supabase SQL Editor)
-- ------------------------------------------------------------
--  Rode os comandos avulsos conforme a necessidade. Tudo aqui roda
--  como administrador do banco (ignora as travas de segurança do site).
-- ============================================================


-- ████████████████████████████████████████████████████████████
--  PARTE 1 — MIGRAÇÃO (rode UMA vez)
--  Cria o mecanismo de "pontos avulsos" e faz o ranking somá-los.
--  Se você criar o banco do zero pelo schema.sql atualizado, isto
--  já vem incluído e não precisa rodar de novo.
-- ████████████████████████████████████████████████████████████

create table if not exists public.adjustments (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  points     int  not null,           -- pode ser negativo (penalidade)
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists adjustments_user_idx on public.adjustments (user_id);

alter table public.adjustments enable row level security;
drop policy if exists "ajustes: admin gerencia" on public.adjustments;
create policy "ajustes: admin gerencia"
  on public.adjustments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Ranking passa a somar os ajustes à pontuação calculada dos palpites.
create or replace function public.get_standings()
returns table (
  user_id      uuid,
  display_name text,
  points       bigint,
  exact_hits   bigint,
  total_bets   bigint
)
language sql
security definer set search_path = public
as $$
  select
    p.id,
    p.display_name,
    coalesce(sum(public.bet_points(b.home_pred, b.away_pred, m.home_score, m.away_score)), 0)
      + coalesce((select sum(a.points) from public.adjustments a where a.user_id = p.id), 0) as points,
    count(*) filter (
      where m.status = 'finished' and b.home_pred = m.home_score and b.away_pred = m.away_score
    ) as exact_hits,
    count(b.id) as total_bets
  from public.profiles p
  left join public.bets b on b.user_id = p.id
  left join public.matches m on m.id = b.match_id and m.status = 'finished'
  group by p.id, p.display_name
  order by points desc, exact_hits desc, p.display_name asc;
$$;


-- ████████████████████████████████████████████████████████████
--  PARTE 2 — CONSULTAS DE APOIO (para achar os IDs)
-- ████████████████████████████████████████████████████████████

-- Quem está cadastrado (e quem é admin):
select u.email, p.display_name, p.id as user_id, p.is_admin
from public.profiles p join auth.users u on u.id = p.id
order by p.display_name;

-- Lista de jogos com o id de cada um:
select id as match_id, stage, home_team, away_team, kickoff, home_score, away_score
from public.matches order by kickoff;

-- Achar um jogo específico pelos times:
-- select id, stage, home_team, away_team, kickoff
-- from public.matches
-- where home_team ilike '%brasil%' or away_team ilike '%brasil%';

-- Ver os palpites de um participante:
-- select m.stage, m.home_team, m.away_team, b.home_pred, b.away_pred, b.updated_at
-- from public.bets b join public.matches m on m.id = b.match_id
-- where b.user_id = (select id from auth.users where email = 'fulano@email.com')
-- order by m.kickoff;


-- ████████████████████████████████████████████████████████████
--  PARTE 3 — LANÇAR / CORRIGIR PALPITE EM NOME DE UM USUÁRIO
-- ████████████████████████████████████████████████████████████
-- Troque o e-mail, o match_id e o placar (home_pred x away_pred).
-- Este comando cria o palpite se não existir, ou CORRIGE se já existir
-- (ideal para "ajustar o erro de algum usuário"). Não respeita a trava
-- do horário do jogo — é lançamento administrativo, use com critério.

insert into public.bets (user_id, match_id, home_pred, away_pred)
values (
  (select id from auth.users where email = 'fulano@email.com'),  -- e-mail do participante
  1,    -- match_id (pegue na consulta de jogos acima)
  2,    -- gols do mandante
  1     -- gols do visitante
)
on conflict (user_id, match_id) do update
  set home_pred  = excluded.home_pred,
      away_pred  = excluded.away_pred,
      updated_at = now();

-- Apagar um palpite lançado por engano:
-- delete from public.bets
-- where user_id = (select id from auth.users where email = 'fulano@email.com')
--   and match_id = 1;


-- ████████████████████████████████████████████████████████████
--  PARTE 4 — PONTOS AVULSOS (bônus / penalidade / correção)
-- ████████████████████████████████████████████████████████████
-- Soma direto no ranking, independente de palpite. Use negativo para tirar.

-- Dar bônus de 5 pontos:
insert into public.adjustments (user_id, points, reason)
values (
  (select id from auth.users where email = 'fulano@email.com'),
  5,
  'Bônus de participação'
);

-- Tirar 3 pontos (penalidade): use points = -3.

-- Ver todos os ajustes lançados:
-- select u.email, a.points, a.reason, a.created_at
-- from public.adjustments a
-- join auth.users u on u.id = a.user_id
-- order by a.created_at desc;

-- Desfazer um ajuste específico (pegue o id na consulta acima):
-- delete from public.adjustments where id = 1;
