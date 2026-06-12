-- ============================================================
--  MIGRAÇÃO — Nova pontuação (10/5/0) + Palpite do pódio
--  Rode UMA vez no Supabase (SQL Editor). É seguro: usa
--  "create or replace" / "if not exists".
-- ============================================================

-- 1) NOVA REGRA DE PONTOS DOS JOGOS (10 exato / 5 resultado certo / 0)
create or replace function public.bet_points(
  b_home int, b_away int, m_home int, m_away int
) returns int
language sql immutable
as $$
  select case
    when m_home is null or m_away is null then 0
    when b_home = m_home and b_away = m_away then 10
    when sign(b_home - b_away) = sign(m_home - m_away) then 5
    else 0
  end;
$$;

-- 2) TABELAS DO PÓDIO
create table if not exists public.podium_config (
  id        int primary key default 1 check (id = 1),
  deadline  timestamptz,
  champion  text,
  runner_up text,
  third     text
);
insert into public.podium_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.podium_bets (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  champion   text not null,
  runner_up  text not null,
  third      text not null,
  updated_at timestamptz not null default now(),
  check (champion <> runner_up and champion <> third and runner_up <> third)
);

-- 3) SEGURANÇA DO PÓDIO
alter table public.podium_config enable row level security;
alter table public.podium_bets   enable row level security;

drop policy if exists "podio cfg: leitura" on public.podium_config;
create policy "podio cfg: leitura"
  on public.podium_config for select to anon, authenticated using (true);
drop policy if exists "podio cfg: admin" on public.podium_config;
create policy "podio cfg: admin"
  on public.podium_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "podio: ler o proprio" on public.podium_bets;
create policy "podio: ler o proprio"
  on public.podium_bets for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "podio: inserir antes do prazo" on public.podium_bets;
create policy "podio: inserir antes do prazo"
  on public.podium_bets for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.podium_config c
                where c.id = 1 and (c.deadline is null or c.deadline > now()))
  );

drop policy if exists "podio: atualizar antes do prazo" on public.podium_bets;
create policy "podio: atualizar antes do prazo"
  on public.podium_bets for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.podium_config c
                where c.id = 1 and (c.deadline is null or c.deadline > now()))
  );

-- 4) RANKING = palpites + ajustes + bônus do pódio
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
      + coalesce((select sum(a.points) from public.adjustments a where a.user_id = p.id), 0)
      + coalesce((
          select (case when pb.champion  = pc.champion  and pc.champion  is not null then 100 else 0 end)
               + (case when pb.runner_up = pc.runner_up and pc.runner_up is not null then  70 else 0 end)
               + (case when pb.third     = pc.third     and pc.third     is not null then  50 else 0 end)
          from public.podium_bets pb, public.podium_config pc
          where pb.user_id = p.id and pc.id = 1
        ), 0) as points,
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
