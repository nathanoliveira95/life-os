# Oliver no WhatsApp 🤖💬

Assistente que deixa você **preencher dados e checar status do app Oliver pelo WhatsApp**.
Ele escreve no mesmo Supabase que o site usa, então tudo aparece no site automaticamente
— **sem alterar o site**.

Exemplos do que você manda no WhatsApp:
- "fiz treino A hoje" → registra treino
- "dieta 90%" → registra dieta do dia
- "estudei 30 min de reading" → registra sessão de inglês
- "como tá meu dia?" → responde com treino/dieta/metas/tarefas

---

## O que você vai precisar (uma vez)

1. Uma conta no **console.anthropic.com** com um pouco de crédito (a chave da IA).
2. Uma conta no **Meta for Developers** (WhatsApp Cloud API — grátis).
3. O **Supabase** do Oliver ativo (aquele mesmo do app).

> ⏱️ Leva ~30–45 min na primeira vez. Depois é só usar.

---

## Passo 1 — Chave da IA (Claude)

1. Entre em https://console.anthropic.com → **API Keys** → crie uma chave (começa com `sk-ant-...`).
2. Adicione um crédito pequeno em **Billing** (uns US$5 duram MUITO pra esse uso).
3. Guarde a chave — vai virar o segredo `ANTHROPIC_API_KEY`.

## Passo 2 — WhatsApp Cloud API (Meta)

1. Em https://developers.facebook.com → **Meus Apps** → **Criar app** → tipo **Empresa**.
2. Adicione o produto **WhatsApp**.
3. Na tela do WhatsApp você verá:
   - Um **número de teste** grátis e o **Phone Number ID** → esse é o `WHATSAPP_PHONE_ID`.
   - Um **token temporário** (24h). Para uso contínuo, gere um **token permanente**
     (via *System User* nas configurações da empresa) → esse é o `WHATSAPP_TOKEN`.
4. Ainda nessa tela, adicione **o seu número pessoal** como destinatário de teste
   (é pra onde/quem vai conversar). Seu número no formato internacional
   (ex: `5511999999999`) é o `ALLOWED_WA_ID`.
5. Invente uma senha qualquer (ex: `oliver-verify-123`) → será o `WHATSAPP_VERIFY_TOKEN`.

## Passo 3 — Deploy da função no Supabase

Precisa da **Supabase CLI** (uma vez):
```bash
npm install -g supabase
supabase login
```

Na pasta do projeto (onde está a pasta `supabase/`):
```bash
# liga a CLI ao seu projeto (o ref aparece na URL: https://<ref>.supabase.co)
supabase link --project-ref SEU_PROJECT_REF

# cadastra os segredos
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
supabase secrets set WHATSAPP_TOKEN=EAAG...xxxxx
supabase secrets set WHATSAPP_PHONE_ID=1234567890
supabase secrets set WHATSAPP_VERIFY_TOKEN=oliver-verify-123
supabase secrets set ALLOWED_WA_ID=5511999999999

# publica a função (sem exigir login do WhatsApp em cada request)
supabase functions deploy whatsapp-oliver --no-verify-jwt
```

No fim, a CLI mostra a URL da função, algo como:
```
https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-oliver
```
Copie essa URL.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` **não** precisam ser cadastrados —
> o Supabase injeta automaticamente nas Edge Functions.

## Passo 4 — Ligar o webhook do WhatsApp na função

1. Volta no painel da Meta → WhatsApp → **Configuration** → **Webhook** → **Edit**.
2. **Callback URL**: cole a URL da função (do passo 3).
3. **Verify token**: o mesmo `WHATSAPP_VERIFY_TOKEN` (ex: `oliver-verify-123`).
4. Clique **Verify and save** (a Meta faz um GET de verificação; a função responde).
5. Em **Webhook fields**, assine **`messages`**.

## Passo 5 — Testar 🎉

Mande uma mensagem do **seu número** (o `ALLOWED_WA_ID`) para o número de teste do WhatsApp:
- "fiz treino B hoje"
- "dieta 85%"
- "como tá meu dia?"

Abra o site Oliver e veja os dados aparecendo (o Supabase precisa estar **ativo** — se
tiver pausado, clique em *Resume* no painel do Supabase).

---

## Como adicionar mais comandos depois

Cada comando é uma "ferramenta" no arquivo `index.ts` (lista `TOOLS`) + um trecho em
`runTool`. Dá pra adicionar facilmente: registrar tarefa nova, marcar meta, registrar peso,
etc. É só pedir. As chaves e formatos seguem os mesmos que o app usa na tabela `lifeos_data`.

## Segurança 🔒

- Só o número em `ALLOWED_WA_ID` consegue comandar a IA.
- Os segredos ficam no Supabase (não no código).
- A função usa a `service_role` internamente, mas **nunca** a expõe.
- Ainda assim, lembre: o banco `lifeos_data` é público (definido no SQL do app). Isso é ok
  para uso pessoal; se um dia quiser proteger com login, dá pra evoluir.

## Custos

- **WhatsApp Cloud API**: grátis para conversas de serviço (uso pessoal cabe folgado).
- **Supabase Edge Functions**: plano grátis cobre de sobra.
- **Claude Haiku**: cada mensagem custa fração de centavo.
