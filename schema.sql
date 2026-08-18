-- ═══════════════════════════════════════════════════════════
-- Cole isso inteiro no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez sem quebrar nada.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '',
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

-- ── Row Level Security ────────────────────────────────────
-- Sem isto, a chave anon (que é pública) leria tudo.
-- Com isto, cada linha só é visível pro dono dela.

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

-- ── updated_at à prova de cliente com relógio errado ──────
-- O horário do servidor manda. Se o relógio do celular estiver
-- adiantado, a nota não fica grudada no topo da lista.

create or replace function public.notes_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch
  before insert or update on public.notes
  for each row execute function public.notes_touch_updated_at();

-- ── Realtime (sync instantâneo entre celular e PC) ────────

alter table public.notes replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
end
$$;
