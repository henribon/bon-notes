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

  // Opcional: só este email consegue usar o formulário de cadastro.
  // É só uma trava de conveniência na interface — a trava de verdade
  // é desligar "Allow new users to sign up" no painel do Supabase.
  ALLOWED_EMAIL: 'henribonrec@gmail.com',
};
