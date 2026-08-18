# Notas

Bloco de notas pessoal, minimalista, estilo Notion. Roda no GitHub Pages (site
estático) com login de verdade e sincronização entre celular e computador via
[Supabase](https://supabase.com) — plano grátis dá e sobra.

- Markdown com preview (`Ctrl+E`)
- Pastas e notas fixadas, convivendo no mesmo nível
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

O site **não tem tela de cadastro** — só login. A primeira conta você cria pelo
painel do Supabase:

1. **Authentication → Users → Add user → Create new user**.
2. Preencha email e senha, e marque **Auto Confirm User**.

Agora tranque a porta, e este é o passo que importa:

3. **Authentication → Sign In / Providers → Email** →
   **desligue** `Allow new users to sign up` → **Save**.

> Sem o passo 3, tirar o botão de cadastro do site não adianta nada: o endpoint
> de signup do Supabase fica exposto na internet e qualquer pessoa cria conta
> com um `curl`, sem nunca abrir sua página. Quem bloqueia é o servidor.

Confirme que ficou trancado:

```bash
curl -s -X POST "https://xxxx.supabase.co/auth/v1/signup" -H "apikey: SUA-CHAVE-PUBLICA" -H "Content-Type: application/json" -d '{"email":"teste@example.com","password":"seja-o-que-for-123"}'
```

Tem que voltar um erro dizendo que signups estão desabilitados. Se voltar um
usuário criado, o passo 3 não salvou — apague o usuário em **Authentication →
Users** e tente de novo.

### E se eu quiser convidar alguém um dia?

Crie a conta da pessoa você mesmo em **Authentication → Users → Add user**. Isso
mantém o cadastro fechado e você continua sendo quem decide quem entra. Um
sistema de "código de convite" validado no navegador **não** funcionaria — o
código estaria no JavaScript da página, visível pra qualquer um, e ainda assim
daria pra pular a página e chamar a API direto. Código de convite de verdade
exige uma Edge Function validando no servidor.

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
| `Ctrl/Cmd + D` | Fixar / desafixar a nota aberta |
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
schema.sql               tabelas + políticas de RLS + realtime
sw.js                    cache da casca do app pra funcionar offline
manifest.webmanifest     metadados do PWA
```

## Pastas e notas fixadas

Pastas e notas moram no mesmo nível da barra lateral. Uma nota com `folder_id`
nulo aparece na raiz, ao lado das pastas; uma nota com `folder_id` preenchido
some da raiz e passa a viver dentro da pasta.

Na prática: com as notas X, Y e Z, criar a pasta `AQUI` e mover X pra ela deixa a
raiz com `AQUI`, `Y` e `Z`. Abrindo `AQUI`, você vê só o X.

Pastas e notas ficam numa lista só, sem cabeçalhos separando as duas coisas.
A ordem é: fixadas no topo, pastas em seguida, depois as notas soltas por
recência.

- **Criar pasta:** botão de pasta ao lado de "Nova nota".
- **Mover uma nota:** arraste ela pra cima da pasta. Com a nota aberta, o
  seletor no topo do editor faz o mesmo — é o caminho no celular, onde arrastar
  não funciona.
- **Tirar da pasta:** entre na pasta e arraste a nota pro botão de voltar. Ou
  escolha "Sem pasta" no seletor.
- **Criar já dentro:** abra a pasta e clique em "Nova nota".
- **Renomear / excluir:** entre na pasta — os botões aparecem no topo da lista.

Excluir uma pasta **não apaga as notas de dentro** — elas voltam pra raiz. Isso
vale tanto no app quanto no banco (`on delete set null` na coluna `folder_id`),
então nem um acidente pelo painel do Supabase leva suas notas junto.

Notas fixadas (`★`, ou `Ctrl+D`) sobem para uma seção **Fixadas** no topo da
raiz — inclusive as que estão dentro de pastas, que é justamente a graça de
fixar. Dentro de uma pasta, as fixadas ficam no topo daquela pasta.

A busca ignora a navegação atual e a pasta: ela procura em tudo, sempre.

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

## Segurança: o que protege o quê

| Camada | Onde roda | O que faz |
| --- | --- | --- |
| Senha | Servidor Supabase | Guardada só como hash bcrypt. Não passa pelo código deste site nem pelo repositório. |
| HTTPS | GitHub Pages + Supabase | Ambos forçam TLS. Ninguém lê sua senha na rede, nem em Wi-Fi público. |
| RLS | Servidor Supabase | Cada linha da tabela só é legível pelo dono. É o que impede a chave pública de virar chave-mestra. |
| Signup desligado | Servidor Supabase | Impede contas novas, inclusive por chamada direta na API. |
| SRI | Navegador | Os `<script>` de CDN têm hash `integrity`. Se o arquivo mudar um byte, o navegador se recusa a executar. |
| DOMPurify | Navegador | Limpa o HTML gerado do markdown antes de exibir. |

### O que ainda depende de você

1. **A força da sua senha.** O endpoint de login é público — dá pra tentar
   adivinhar de fora. O Supabase limita a taxa de tentativas, mas quem decide se
   é inviável ou não é o tamanho da senha. Use algo longo e exclusivo deste site.
2. **Ative MFA** em **Authentication → Multi-Factor**. Com isso, saber a senha
   deixa de ser suficiente.
3. **Proteja seu Gmail.** O "esqueci a senha" manda um link pra lá. Na prática,
   quem controla seu email controla esta conta — 2FA no Gmail vale mais aqui do
   que qualquer coisa neste repositório.
4. **Cuidado com o aparelho.** A sessão fica no `localStorage`. Quem destrava seu
   celular ou seu PC entra sem senha nenhuma. Use **Sair** em máquina emprestada.

### O que um estranho consegue ver

Abrindo seu site e o DevTools, qualquer pessoa vê a URL do projeto e a chave
pública. Com elas ela consegue exatamente uma coisa: bater na API como visitante
anônimo. Com o RLS ligado e o signup desligado, isso rende `[]` e uma mensagem de
erro. É o desenho esperado, não uma falha.
