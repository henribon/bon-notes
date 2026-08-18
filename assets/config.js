/* ─────────────────────────────────────────────────────────────
   Preencha os dois valores abaixo com os dados do SEU projeto
   Supabase (Project Settings → API Keys).

   Pode commitar isso num repositório público sem medo. A chave
   pública ("anon public" ou "publishable key") foi feita pra
   rodar no navegador, e num site estático não existe onde
   escondê-la: o GitHub Secrets só protege segredos que ficam no
   servidor, e este arquivo é baixado por quem abrir o site.

   Quem protege suas notas é o Row Level Security do schema.sql,
   que roda no servidor do Supabase. NUNCA coloque aqui a chave
   "service_role" nem uma "secret key" — essas ignoram o RLS.
   ───────────────────────────────────────────────────────────── */

window.NOTAS_CONFIG = {
  SUPABASE_URL:      'https://flpvhqiicfecddrbcjtr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_nxmlCCuezNJXp1YhmaFciw_5PGpxxS1',
};

/* Não existe cadastro neste site — a tela de login só faz login.
   Quem realmente bloqueia contas novas é o Supabase, em
   Authentication → Sign In / Providers → "Allow new users to sign up"
   DESLIGADO. Enquanto essa chave estiver ligada, qualquer pessoa pode
   criar conta chamando a API direto, sem passar por esta página.

   Precisa de outra conta algum dia? Crie pelo painel:
   Authentication → Users → Add user. */
