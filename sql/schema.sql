-- ============================================================
--  BOLÃO DA COPA — Esquema do banco de dados (Supabase / Postgres)
-- ------------------------------------------------------------
--  Como usar:
--   1. Crie um projeto gratuito em https://supabase.com
--   2. Abra "SQL Editor" > "New query"
--   3. Cole TODO este arquivo e clique em "Run"
--   4. Pegue a URL e a "anon key" em Project Settings > API
--      e cole em js/config.js
--
--  Tudo aqui é idempotente o suficiente para rodar de novo se
--  precisar (usa "if not exists" / "or replace" onde dá).
-- ============================================================

-- ------------------------------------------------------------
-- 1. PERFIS (1 linha por usuário cadastrado)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém se cadastra.
-- O nome vem do metadata enviado no signUp (display_name).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. JOGOS / PARTIDAS
-- ------------------------------------------------------------
create table if not exists public.matches (
  id          bigint generated always as identity primary key,
  stage       text not null default 'Fase de grupos',  -- ex.: "Grupo A", "Oitavas", "Final"
  home_team   text not null,
  away_team   text not null,
  home_flag   text,                                     -- emoji ou código do país (opcional)
  away_flag   text,
  kickoff     timestamptz not null,                     -- data/hora do jogo (trava as apostas)
  home_score  int,                                      -- preenchido pelo admin após o jogo
  away_score  int,
  status      text not null default 'scheduled'
                check (status in ('scheduled','live','finished')),
  created_at  timestamptz not null default now()
);

create index if not exists matches_kickoff_idx on public.matches (kickoff);

-- ------------------------------------------------------------
-- 3. APOSTAS / PALPITES
-- ------------------------------------------------------------
create table if not exists public.bets (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  match_id   bigint not null references public.matches (id) on delete cascade,
  home_pred  int not null check (home_pred >= 0 and home_pred <= 30),
  away_pred  int not null check (away_pred >= 0 and away_pred <= 30),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)            -- um palpite por jogo por pessoa
);

create index if not exists bets_user_idx on public.bets (user_id);
create index if not exists bets_match_idx on public.bets (match_id);

-- ------------------------------------------------------------
-- 3.5. AJUSTES DE PONTOS  (bônus / penalidades / correções — só admin)
-- ------------------------------------------------------------
-- Pontos "avulsos" que não vêm de palpite. Entram no ranking somados
-- à pontuação calculada. points pode ser negativo (penalidade).
create table if not exists public.adjustments (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  points     int  not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists adjustments_user_idx on public.adjustments (user_id);

-- ------------------------------------------------------------
-- 4. REGRA DE PONTUAÇÃO  (ajuste os números aqui se quiser)
-- ------------------------------------------------------------
--   Placar exato ............................... 10 pontos
--   Acertou o vencedor E o saldo de gols ........  7 pontos
--   Acertou só o vencedor / empate ..............  5 pontos
--   Errou .......................................  0 pontos
create or replace function public.bet_points(
  b_home int, b_away int, m_home int, m_away int
) returns int
language sql immutable
as $$
  select case
    when m_home is null or m_away is null then 0
    when b_home = m_home and b_away = m_away then 10
    when sign(b_home - b_away) = sign(m_home - m_away)
         and abs(b_home - b_away) = abs(m_home - m_away) then 7
    when sign(b_home - b_away) = sign(m_home - m_away) then 5
    else 0
  end;
$$;

-- ------------------------------------------------------------
-- 5. TABELA CONSOLIDADA (ranking)
-- ------------------------------------------------------------
-- Função SECURITY DEFINER: calcula o total de pontos de TODO
-- mundo sem expor os palpites individuais (que continuam privados).
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

grant execute on function public.get_standings() to anon, authenticated;

-- ------------------------------------------------------------
-- 6. SEGURANÇA (Row Level Security)
-- ------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.matches     enable row level security;
alter table public.bets        enable row level security;
alter table public.adjustments enable row level security;

-- helper: o usuário atual é admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- --- PROFILES ---
drop policy if exists "perfis: ler todos (autenticado)" on public.profiles;
create policy "perfis: ler todos (autenticado)"
  on public.profiles for select to authenticated using (true);

drop policy if exists "perfis: editar o próprio" on public.profiles;
create policy "perfis: editar o próprio"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- --- MATCHES ---
drop policy if exists "jogos: leitura pública" on public.matches;
create policy "jogos: leitura pública"
  on public.matches for select to anon, authenticated using (true);

drop policy if exists "jogos: admin gerencia" on public.matches;
create policy "jogos: admin gerencia"
  on public.matches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- --- BETS ---
-- Cada um lê os próprios palpites; admin lê todos.
drop policy if exists "apostas: ler as próprias" on public.bets;
create policy "apostas: ler as próprias"
  on public.bets for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Só dá para apostar/alterar ANTES do início do jogo.
drop policy if exists "apostas: inserir antes do jogo" on public.bets;
create policy "apostas: inserir antes do jogo"
  on public.bets for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.matches m where m.id = match_id and m.kickoff > now())
  );

drop policy if exists "apostas: atualizar antes do jogo" on public.bets;
create policy "apostas: atualizar antes do jogo"
  on public.bets for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.matches m where m.id = match_id and m.kickoff > now())
  );

-- --- ADJUSTMENTS --- (só admin gerencia; o ranking lê via função SECURITY DEFINER)
drop policy if exists "ajustes: admin gerencia" on public.adjustments;
create policy "ajustes: admin gerencia"
  on public.adjustments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 7. DADOS DE EXEMPLO (apague depois — gerencie pelo painel Admin)
-- ------------------------------------------------------------
-- Descomente para criar alguns jogos de teste:
-- insert into public.matches (stage, home_team, away_team, home_flag, away_flag, kickoff) values
--   ('Grupo A', 'México',    'A definir', '🇲🇽', '🏳️', now() + interval '1 day'),
--   ('Grupo B', 'Canadá',    'A definir', '🇨🇦', '🏳️', now() + interval '2 day'),
--   ('Grupo D', 'EUA',       'A definir', '🇺🇸', '🏳️', now() + interval '3 day'),
--   ('Grupo ?', 'Brasil',    'A definir', '🇧🇷', '🏳️', now() + interval '4 day');

-- ============================================================
--  Para tornar alguém ADMIN, rode (trocando o e-mail):
--    update public.profiles set is_admin = true
--    where id = (select id from auth.users where email = 'voce@exemplo.com');
-- ============================================================
