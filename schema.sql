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

-- ── pastas ────────────────────────────────────────────────
-- Pastas e notas convivem no mesmo nível: uma nota com
-- folder_id nulo mora na raiz, ao lado das pastas.

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null default 'Nova pasta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colunas novas na tabela notes (seguro rodar de novo).
alter table public.notes
  add column if not exists folder_id uuid references public.folders (id) on delete set null;

alter table public.notes
  add column if not exists pinned boolean not null default false;

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

create index if not exists notes_folder_idx
  on public.notes (user_id, folder_id);

create index if not exists folders_user_idx
  on public.folders (user_id, name);

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

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own" on public.folders
  for select using (auth.uid() = user_id);

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own" on public.folders
  for insert with check (auth.uid() = user_id);

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own" on public.folders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own" on public.folders
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

drop trigger if exists folders_touch on public.folders;
create trigger folders_touch
  before insert or update on public.folders
  for each row execute function public.notes_touch_updated_at();

-- ── Realtime (sync instantâneo entre celular e PC) ────────

alter table public.notes replica identity full;
alter table public.folders replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.folders;
exception
  when duplicate_object then null;
end
$$;
