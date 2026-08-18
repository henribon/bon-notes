# Notas

Bloco de notas pessoal, minimalista, estilo Notion. Roda no GitHub Pages (site
estático) com login de verdade e sincronização entre celular e computador via
[Supabase](https://supabase.com) — plano grátis dá e sobra.

- Markdown com preview (`Ctrl+E`)
- Funciona offline: tudo fica no `localStorage` e sobe sozinho quando a rede volta
- Sync ao vivo — editou no PC, aparece no celular sem recarregar
- Tema claro / escuro / sistema
- Instalável como app no celular (PWA)

---

## Por que precisa do Supabase

GitHub Pages serve arquivos e nada mais — não roda servidor, não tem banco.
Um "login" só em JavaScript não protege nada: qualquer pessoa abre o
`Ver código-fonte` e lê a senha. Então o login e as notas moram no Supabase, e
o GitHub Pages serve só a interface.

**Tempo total de setup: uns 10 minutos.**

---

## 1. Criar o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) → **Start your project** → login com GitHub.
2. **New project**. Dê um nome (`notas`), escolha uma senha de banco (guarde, mas
   você não vai precisar dela pra isso aqui) e a região mais perto de você
   (`South America (São Paulo)`).
3. Espere uns 2 minutos até o projeto ficar verde.

## 2. Criar a tabela

1. No menu lateral: **SQL Editor** → **New query**.
2. Abra o arquivo [`schema.sql`](schema.sql) deste repositório, copie tudo, cole lá.
3. **Run**. Tem que aparecer `Success`.

Isso cria a tabela `notes` e, mais importante, liga o **Row Level Security** — a
regra que garante que cada linha só é legível pelo dono. É o que segura a porta.

## 3. Pegar as chaves

1. **Project Settings** (engrenagem) → **API Keys**.
2. Copie a **Project URL** (`https://xxxx.supabase.co`).
3. Copie a chave pública. Dependendo de quando seu projeto foi criado, o painel
   chama ela de um dos dois jeitos — as duas funcionam aqui:
   - **`anon` `public`** — começa com `eyJhbGciOi...`
   - **Publishable key** — começa com `sb_publishable_...`

**Nunca** copie a `service_role` nem uma **Secret key**. Essas ignoram o RLS e
leem o banco inteiro; elas só existem pra código que roda em servidor.

Abra [`assets/config.js`](assets/config.js) e cole as duas:

```js
window.NOTAS_CONFIG = {
  SUPABASE_URL:      'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  ALLOWED_EMAIL: 'seu@email.com',
};
```

> **Por que isso não vai pro GitHub Secrets?** Porque quem precisa da chave é o
> navegador. Num site estático, qualquer valor injetado no build acaba no
> JavaScript publicado — dá pra ler no DevTools em dois cliques. Esconder no
> Secrets seria só teatro.
>
> A chave pública foi feita pra isso: sozinha ela não abre nada. Quem decide o
> que ela pode ler é o RLS, que roda no servidor do Supabase e não dá pra burlar
> pelo navegador.

### Conferir se a tranca funciona

Com o site publicado, rode isto num terminal (sem estar logado em lugar nenhum):

```bash
curl "https://xxxx.supabase.co/rest/v1/notes?select=*" -H "apikey: SUA-CHAVE-PUBLICA"
```

Tem que responder `[]`. Se vierem suas notas, o `schema.sql` não rodou direito e
o RLS está desligado — volte no passo 2.

## 4. Publicar no GitHub Pages

Na pasta do projeto:

```bash
git init && git add -A && git commit -m "Notas: primeira versão"
```

Crie um repositório vazio no GitHub (pode ser público) e:

```bash
git remote add origin https://github.com/SEU-USUARIO/notas.git && git branch -M main && git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`
→ Save**. Em 1–2 minutos o site sai em
`https://SEU-USUARIO.github.io/notas/`.

## 5. Criar sua conta e trancar a porta

1. Abra o site, clique em **Criar conta**, use seu email e uma senha.
2. Confirme pelo link que chega no email.
3. Volte no Supabase: **Authentication → Sign In / Providers → Email** e
   **desligue** `Allow new users to sign up`. → **Save**.

Pronto: agora só a sua conta existe e ninguém mais consegue criar outra.

### Enquanto estiver testando

Se não quiser lidar com email de confirmação durante o setup, dá pra desligar
`Confirm email` na mesma tela — só lembre de considerar religar depois.

### Deixar o Supabase aceitar seu domínio

**Authentication → URL Configuration** → em **Site URL** ponha
`https://SEU-USUARIO.github.io/notas/` e adicione a mesma URL em
**Redirect URLs**. Sem isso o link de "esqueci a senha" volta pro lugar errado.

## 6. Instalar no celular

Abra o site no navegador do celular:

- **Android/Chrome:** menu `⋮` → *Adicionar à tela inicial*
- **iPhone/Safari:** botão compartilhar → *Adicionar à Tela de Início*

Abre em tela cheia, sem barra de navegador, e continua funcionando sem internet.

---

## Rodar local antes de publicar

O service worker e o login precisam de `http://`, não de `file://`:

```bash
python -m http.server 8080
```

Depois abra `http://localhost:8080`. Adicione `http://localhost:8080` nas
**Redirect URLs** do Supabase enquanto estiver testando.

---

## Atalhos

| Atalho | O que faz |
| --- | --- |
| `Ctrl/Cmd + K` | Buscar |
| `Ctrl/Cmd + Shift + J` | Nova nota |
| `Ctrl/Cmd + E` | Alternar preview do markdown |
| `Ctrl/Cmd + S` | Forçar sincronização |
| `Tab` (no corpo) | Indenta dois espaços |
| `Esc` (na busca) | Limpa a busca |

---

## Como os arquivos se dividem

```
index.html               estrutura das três telas: setup, login, app
assets/styles.css        todo o visual, tokens de tema no topo
assets/app.js            estado, sync, editor, autenticação
assets/config.js         suas duas chaves — o único arquivo que você edita
schema.sql               tabela + políticas de RLS + realtime
sw.js                    cache da casca do app pra funcionar offline
manifest.webmanifest     metadados do PWA
```

## Sobre a sincronização

Cada edição atualiza a nota em memória, grava no `localStorage` e entra numa fila
de pendências. A fila sobe pro Supabase depois de 800 ms parado. Se der erro ou
você estiver offline, a nota fica marcada como pendente e o app tenta de novo:
ao voltar a rede, ao trazer a aba pra frente, ou a cada 6 segundos.

No caminho de volta, o app escuta as mudanças da tabela por realtime, e a versão
local em edição sempre ganha da versão do servidor — assim o que você está
digitando não é sobrescrito por um eco da sua própria gravação.

Conflito de verdade (mesma nota editada nos dois aparelhos ao mesmo tempo, os
dois online) resolve por *última escrita vence*. Pra um caderno de uma pessoa só
isso é suficiente; não é o algoritmo do Google Docs.

## Limites do plano grátis do Supabase

500 MB de banco e 50.000 usuários ativos por mês — para notas de texto isso é
efetivamente ilimitado. O único detalhe: projetos sem nenhum acesso por **7 dias
seguidos** entram em pausa e você precisa reativar com um clique no painel. Se
você usa as notas toda semana, nunca vai esbarrar nisso.
