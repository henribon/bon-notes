/* ─────────────────────────────────────────────────────────────
   Preencha os dois valores abaixo com os dados do SEU projeto
   Supabase (Project Settings → API).

   Pode commitar isso num repositório público sem medo: a chave
   "anon public" foi feita pra rodar no navegador. Quem protege
   suas notas é o Row Level Security do schema.sql, não o sigilo
   dessa chave. NUNCA coloque aqui a chave "service_role".
   ───────────────────────────────────────────────────────────── */

window.NOTAS_CONFIG = {
  SUPABASE_URL:      'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'SUA-CHAVE-ANON-PUBLIC',

  // Opcional: só este email consegue usar o formulário de cadastro.
  // É só uma trava de conveniência na interface — a trava de verdade
  // é desligar "Allow new users to sign up" no painel do Supabase.
  ALLOWED_EMAIL: '',
};
