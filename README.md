# ⚽ Bolão da Copa 2026

Plataforma de bolão hospedável de graça no **GitHub Pages**. Participantes se
cadastram, dão palpite no placar de cada jogo e acompanham um ranking que
consolida a pontuação de todo mundo em tempo real.

- **Frontend:** site estático (HTML/CSS/JS puro) — roda no GitHub Pages
- **Backend:** [Supabase](https://supabase.com) (login + banco de dados, plano gratuito)
- **Idioma:** pt-BR

## Como funciona a pontuação

| Acerto | Pontos |
|---|---|
| Placar exato | **10** |
| Resultado certo (placar errado) | **5** |
| Errou | 0 |

> Quer mudar os valores? Edite a função `bet_points` em [`sql/schema.sql`](sql/schema.sql)
> (e a lista `SCORING` em [`js/config.js`](js/config.js), que é só exibição).

---

## Passo a passo de instalação

### 1. Criar o banco no Supabase (grátis, ~5 min)

1. Crie uma conta em **https://supabase.com** e clique em **New project**.
2. Escolha um nome e uma senha para o banco (guarde-a). Região: **South America (São Paulo)**.
3. Quando o projeto subir, abra **SQL Editor → New query**.
4. Cole **todo** o conteúdo de [`sql/schema.sql`](sql/schema.sql) e clique em **Run**.
   Isso cria as tabelas, as regras de segurança e a função do ranking.
5. Vá em **Project Settings → Data API** e copie:
   - **Project URL**
   - **anon public** (em "Project API keys")

### 2. Configurar o site

Edite [`js/config.js`](js/config.js) e cole os dois valores:

```js
export const SUPABASE_URL  = "https://SEU-PROJETO.supabase.co";
export const SUPABASE_ANON_KEY = "sua-anon-key-aqui";
```

> A `anon key` é **pública** por natureza — pode commitar sem medo. A segurança
> real vem das políticas RLS criadas pelo `schema.sql`.

### 3. (Opcional) Login sem confirmação de e-mail

Para a turma entrar na hora, sem clicar em link de confirmação:
**Authentication → Sign In / Providers → Email** → desligue **Confirm email**.

### 4. Publicar no GitHub Pages

```bash
# dentro da pasta do projeto
git init
git add .
git commit -m "Bolão da Copa"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/bolao-da-copa.git
git push -u origin main
```

No GitHub: **Settings → Pages → Source: `main` / root → Save**.
Em ~1 minuto o site fica no ar em `https://SEU-USUARIO.github.io/bolao-da-copa/`.

### 5. Virar administrador

Cadastre-se normalmente pelo site. Depois, no Supabase (**SQL Editor**), rode
trocando pelo seu e-mail:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'voce@exemplo.com');
```

Recarregue o site — a aba **Admin** aparece. Lá você **cadastra os jogos** e
**lança os resultados** (o ranking recalcula sozinho).

### Carga em lote de jogos

Para subir vários jogos de uma vez (ex.: toda a fase de grupos), use o painel
**Carga em lote** no Admin. Cole uma linha por jogo, com os campos separados por
`;` (ponto e vírgula) **ou** por TAB — dá para montar no Excel e colar direto.

Ordem das colunas:

```
Fase ; Mandante ; Visitante ; Data e hora ; Bandeira mandante ; Bandeira visitante
```

As duas últimas (bandeiras) são opcionais. A data aceita `DD/MM/AAAA HH:MM`
(horário de Brasília) ou `AAAA-MM-DD HH:MM`. Exemplo:

```
Grupo A ; México ; A definir ; 11/06/2026 17:00 ; 🇲🇽
Grupo B ; Canadá ; A definir ; 12/06/2026 13:00 ; 🇨🇦
Grupo D ; EUA    ; A definir ; 12/06/2026 16:00 ; 🇺🇸
```

Linhas inválidas (data impossível, time em branco, menos de 4 campos) são
ignoradas e listadas no relatório, sem travar as demais. Depois, é só seguir
adicionando jogos individuais pelo formulário ao lado.

---

## Testar localmente

Como o app usa módulos ES, abra com um servidor (não pelo `file://`):

```bash
# Python
python -m http.server 8000
# depois acesse http://localhost:8000
```

## Estrutura

```
.
├── index.html        # marcação das telas (auth, jogos, ranking, admin)
├── css/styles.css    # identidade visual Viseu (teal + laranja sobre areia)
├── js/
│   ├── config.js     # ← suas credenciais do Supabase
│   └── app.js        # lógica (auth, palpites, ranking, admin)
├── fonts/            # Dita Cd (display da marca Viseu)
├── assets/           # logo Viseu
├── sql/schema.sql    # banco: tabelas, RLS e pontuação
└── README.md
```

## Privacidade dos palpites

Cada participante só enxerga os **próprios** palpites — as políticas RLS
impedem ler os dos outros. O ranking mostra apenas o **total de pontos** (via
uma função que não expõe os placares individuais). Apostas **travam
automaticamente** no horário de início de cada jogo.
