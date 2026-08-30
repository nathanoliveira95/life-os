// =====================================================================
// Oliver — Assistente de WhatsApp (Supabase Edge Function / Deno)
//
// Fluxo:
//   WhatsApp (Meta Cloud API)  ->  esta função  ->  Claude Haiku (entende)
//        ->  grava/lê no Supabase (tabela lifeos_data)  ->  responde no WhatsApp
//
// O site Oliver lê o mesmo Supabase em tempo real, então tudo que a IA
// grava aqui aparece no site automaticamente. Esta função NÃO altera o site.
//
// Variáveis de ambiente necessárias (Supabase -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY      chave da API do Claude (console.anthropic.com)
//   WHATSAPP_TOKEN         token do WhatsApp Cloud API (Meta)
//   WHATSAPP_PHONE_ID      Phone Number ID do número remetente (Meta)
//   WHATSAPP_VERIFY_TOKEN  uma senha qualquer que você inventa (p/ verificar o webhook)
//   ALLOWED_WA_ID          seu número no formato internacional, ex: 5599999999999
//                          (só esse número pode comandar a IA)
//   SUPABASE_URL           injetado automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY  injetado automaticamente pelo Supabase
// =====================================================================

const ANTHROPIC_API_KEY     = Deno.env.get("ANTHROPIC_API_KEY")!;
const WHATSAPP_TOKEN        = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_PHONE_ID     = Deno.env.get("WHATSAPP_PHONE_ID")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const ALLOWED_WA_ID         = Deno.env.get("ALLOWED_WA_ID") || "";
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "claude-haiku-4-5";

// ---------- Data no fuso de Brasília (igual ao app) ----------
function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
}

// ---------- Supabase REST (tabela lifeos_data: key/value jsonb) ----------
async function lsGet(key: string): Promise<any> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/lifeos_data?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`lsGet ${key}: ${r.status}`);
  const rows = await r.json();
  return rows?.[0]?.value ?? null;
}

async function lsSet(key: string, value: any): Promise<void> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/lifeos_data?on_conflict=key`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    },
  );
  if (!r.ok) throw new Error(`lsSet ${key}: ${r.status} ${await r.text()}`);
}

// ---------- Ferramentas que a IA pode chamar ----------
const TREINO_OPTS = ["A", "B", "C", "D", "E", "R", "X"];

const TOOLS = [
  {
    name: "registrar_treino",
    description:
      "Registra o treino de um dia. Valores: A/B/C/D/E = treino feito daquele tipo; R = descanso planejado; X = faltou. Se o usuário não disser a data, use o dia de hoje.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data YYYY-MM-DD. Omita para hoje." },
        valor: { type: "string", enum: TREINO_OPTS, description: "A,B,C,D,E,R ou X" },
      },
      required: ["valor"],
    },
  },
  {
    name: "registrar_dieta",
    description:
      "Registra a porcentagem da dieta seguida num dia (0 a 100). Se não disser a data, use hoje.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data YYYY-MM-DD. Omita para hoje." },
        percentual: { type: "integer", description: "0 a 100" },
      },
      required: ["percentual"],
    },
  },
  {
    name: "registrar_nota",
    description:
      "Salva/atualiza a nota diária (texto livre) de um dia. Se não disser a data, use hoje.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data YYYY-MM-DD. Omita para hoje." },
        texto: { type: "string" },
      },
      required: ["texto"],
    },
  },
  {
    name: "registrar_sessao_ingles",
    description:
      "Registra uma sessão de estudo de inglês (TOEFL): minutos e a habilidade estudada.",
    input_schema: {
      type: "object",
      properties: {
        minutos: { type: "integer" },
        skill: { type: "string", enum: ["reading", "listening", "speaking", "writing"] },
        nota: { type: "string", description: "observação opcional" },
      },
      required: ["minutos", "skill"],
    },
  },
  {
    name: "ver_status",
    description:
      "Consulta um resumo do dia: treino e dieta de hoje, quantidade de metas ativas e tarefas em aberto. Use quando o usuário perguntar como estão as coisas.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------- Execução de cada ferramenta ----------
async function runTool(name: string, input: any): Promise<string> {
  const dia = (input?.data && /^\d{4}-\d{2}-\d{2}$/.test(input.data)) ? input.data : hojeBR();

  if (name === "registrar_treino") {
    const saude = (await lsGet("saude")) || {};
    saude[dia] = { ...(saude[dia] || {}), treino: input.valor };
    await lsSet("saude", saude);
    return `Treino "${input.valor}" registrado em ${dia}.`;
  }

  if (name === "registrar_dieta") {
    let pct = parseInt(input.percentual);
    if (isNaN(pct)) return "Percentual inválido.";
    pct = Math.max(0, Math.min(100, pct));
    const saude = (await lsGet("saude")) || {};
    saude[dia] = { ...(saude[dia] || {}), dietPct: String(pct) };
    await lsSet("saude", saude);
    return `Dieta ${pct}% registrada em ${dia}.`;
  }

  if (name === "registrar_nota") {
    const nd = (await lsGet("notediario")) || {};
    const prev = nd[dia] || {};
    nd[dia] = { ...prev, general: input.texto };
    await lsSet("notediario", nd);
    return `Nota salva em ${dia}.`;
  }

  if (name === "registrar_sessao_ingles") {
    const eng = (await lsGet("english")) || { scores: {}, vocab: [], sessions: [], tasks: [] };
    if (!Array.isArray(eng.sessions)) eng.sessions = [];
    eng.sessions.unshift({
      id: "s" + Date.now().toString(36),
      date: hojeBR(),
      skill: input.skill,
      mins: parseInt(input.minutos) || 0,
      note: input.nota || "",
    });
    await lsSet("english", eng);
    return `Sessão de inglês (${input.skill}, ${input.minutos} min) registrada.`;
  }

  if (name === "ver_status") {
    const saude = (await lsGet("saude")) || {};
    const hoje = saude[hojeBR()] || {};
    const goals = (await lsGet("goals")) || [];
    const tasks = (await lsGet("tasks")) || [];
    const abertas = Array.isArray(tasks) ? tasks.filter((t: any) => t.status !== "Done").length : 0;
    const ativas = Array.isArray(goals) ? goals.length : 0;
    return JSON.stringify({
      data: hojeBR(),
      treino_hoje: hoje.treino || "sem registro",
      dieta_hoje: hoje.dietPct != null && hoje.dietPct !== "" ? hoje.dietPct + "%" : "sem registro",
      metas: ativas,
      tarefas_abertas: abertas,
    });
  }

  return `Ferramenta desconhecida: ${name}`;
}

// ---------- Claude (loop de tool use) ----------
const SYSTEM = `Você é o Oliver, assistente pessoal do usuário via WhatsApp.
Sua função é PREENCHER dados e CONSULTAR status usando as ferramentas disponíveis.
Seja direto e curto. Confirme o que registrou em uma frase. Fale português do Brasil.
Nunca invente dados: se precisar registrar algo, use a ferramenta correspondente.
Quando o usuário perguntar como estão as coisas, use ver_status.`;

async function askClaude(userText: string): Promise<string> {
  const messages: any[] = [{ role: "user", content: userText }];

  for (let step = 0; step < 5; step++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
    });
    if (!resp.ok) {
      console.error("Claude erro:", resp.status, await resp.text());
      return "⚠️ Tive um problema pra pensar agora. Tenta de novo daqui a pouco.";
    }
    const data = await resp.json();
    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason === "tool_use") {
      const toolResults: any[] = [];
      for (const block of data.content) {
        if (block.type === "tool_use") {
          let out: string;
          try { out = await runTool(block.name, block.input); }
          catch (e) { out = "Erro ao executar: " + (e as Error).message; }
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue; // deixa o Claude formular a resposta final
    }

    // resposta final em texto
    const txt = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    return txt || "Feito. ✅";
  }
  return "Feito. ✅";
}

// ---------- WhatsApp: enviar mensagem ----------
async function sendWhatsApp(to: string, body: string): Promise<void> {
  const r = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body } }),
  });
  if (!r.ok) console.error("WhatsApp send erro:", r.status, await r.text());
}

// ---------- Servidor HTTP ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1) Verificação do webhook (a Meta chama isso uma vez, via GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  // 2) Mensagens recebidas (POST)
  if (req.method === "POST") {
    let payload: any;
    try { payload = await req.json(); } catch { return new Response("ok", { status: 200 }); }

    try {
      const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      // Ignora callbacks de status (entregue/lido) — só reage a mensagens de texto
      if (msg && msg.type === "text") {
        const from: string = msg.from;
        const text: string = msg.text?.body || "";

        // Segurança: só o seu número pode comandar
        if (ALLOWED_WA_ID && from !== ALLOWED_WA_ID) {
          await sendWhatsApp(from, "Desculpe, este assistente é privado.");
          return new Response("ok", { status: 200 });
        }

        const reply = await askClaude(text);
        await sendWhatsApp(from, reply);
      }
    } catch (e) {
      console.error("Erro processando mensagem:", e);
    }
    // Sempre responder 200 rápido pra Meta não reenviar
    return new Response("ok", { status: 200 });
  }

  return new Response("ok", { status: 200 });
});
