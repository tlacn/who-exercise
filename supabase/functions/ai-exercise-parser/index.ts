import { withSupabase } from "npm:@supabase/server@0.6.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MODEL = "gpt-5.6-luna";

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function extractOutput(data: any) {
  return data?.output_text ||
    data?.output?.map((x: any) => x.content?.map((y: any) => y.text || "").join("")).join("") ||
    "";
}

async function callOpenAI(apiKey: string, input: any, max_output_tokens: number) {
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input,
      max_output_tokens,
      store: false
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || "OpenAI request failed");
  return extractOutput(data);
}

async function parseExercise(apiKey: string, text: string) {
  const prompt = `운동기록 앱의 자연어 입력을 구조화하세요.

입력:
${text}

반드시 JSON 하나만 반환하세요.

허용 activity:
powerwalk, walk, run, stairs, cycle, hiking, housework, strength, interval

규칙:
- 스쿼트, 런지, 푸시업, 팔굽혀펴기, 플랭크, 덤벨, 아령, 웨이트, 근력, 저항운동, 풀업, 턱걸이 등은 strength.
- 청소, 세탁, 정리, 설거지, 매트/가구 이동 등은 housework.
- 달리기/조깅/러닝은 run.
- 파워워킹/빠르게 걷기는 powerwalk.
- 일반 걷기/산책은 walk.
- 계단은 stairs.
- 자전거/사이클은 cycle.
- 등산/오르막은 hiking.
- 인터벌은 interval.
- 운동 동작이 명확하게 언급되면 housework로 분류하지 마세요.
- 날짜가 없으면 오늘.
- 시간은 분 단위 number. 명시되지 않으면 null.
- 세트 수가 있으면 sets number, 없으면 null.
- 페이스가 있으면 MM:SS 문자열, 없으면 null.
- note에는 원문을 그대로 넣으세요.
- 확실하지 않으면 메모의 단서를 이용해 가장 가까운 운동 종류를 선택하세요.
`;

  const output = await callOpenAI(
    apiKey,
    [
      { role: "system", content: "You are a precise Korean exercise-log parser. Return JSON only." },
      { role: "user", content: prompt }
    ],
    300
  );
  return JSON.parse(output);
}

function cleanMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10)
    .map((m: any) => ({
      role: m.role,
      content: m.content.slice(0, 1400)
    }));
}

async function chatWithCoach(
  apiKey: string,
  ctx: any,
  messages: unknown,
  weeklyGoal: number,
  today: string
) {
  const safeMessages = cleanMessages(messages);
  if (!safeMessages.length) throw new Error("chat messages required");

  const { data: rows, error } = await ctx.supabase
    .from("exercise_records")
    .select("date,activity,intensity,minutes,met,label,pace,speed_kmh,note,interval,segment")
    .order("date", { ascending: false })
    .limit(180);

  if (error) throw new Error("운동 기록을 불러오지 못했습니다: " + error.message);

  const records = (rows || []).map((r: any) => ({
    date: r.date,
    activity: r.activity,
    intensity: r.intensity,
    minutes: Number(r.minutes || 0),
    met: r.met != null ? Number(r.met) : null,
    label: r.label || "",
    pace: r.pace || null,
    speedKmh: r.speed_kmh != null ? Number(r.speed_kmh) : null,
    note: r.note || "",
    interval: !!r.interval,
    segment: r.segment || ""
  }));

  const system = `당신은 이 운동 기록 앱 안에서 작동하는 GPT 운동 코치입니다.

오늘 날짜: ${today}
사용자 주간 목표(앱 환산점): ${weeklyGoal}

아래는 로그인한 사용자의 운동 기록입니다. 이 기록만 개인 기록의 사실 근거로 사용하세요.
개인 기록에 없는 내용을 있었다고 만들지 마세요. 날짜·시간·강도·운동 종류를 정확히 구분하세요.

운동 기록 JSON:
${JSON.stringify(records)}

답변 규칙:
1. 질문에 바로 답하고, 필요하면 숫자를 계산해 보여주세요.
2. "이번 주", "최근", "지난달" 같은 표현은 제공된 실제 날짜를 기준으로 계산하세요.
3. 주간 운동량은 앱의 환산 방식(중강도 1분=1점, 고강도 1분=2점)과 주간 목표를 기준으로 설명하세요.
4. 사용자의 실제 기록에서 보이는 패턴을 활용해 다음 운동이나 개선 방법을 구체적으로 제안하세요.
5. 기록이 부족해서 판단할 수 없으면 부족한 데이터를 그대로 말하세요.
6. 의료 진단을 하지 말고, 통증·질환·약물 등 의료 판단이 필요한 질문은 의료진 상담이 필요하다는 수준에서 답하세요.
7. 기록 추가/수정 명령을 받더라도 이 대화에서는 DB를 직접 바꾸지 마세요. 사용자가 확인 후 "AI 운동 기록" 입력창으로 저장하게 안내하세요.
8. 한국어로, 읽기 쉽게 답하세요. 불필요한 장황한 서론은 피하세요.`;

  return callOpenAI(
    apiKey,
    [
      { role: "system", content: system },
      ...safeMessages
    ],
    900
  );
}

Deno.serve(
  withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    try {
      const body = await req.json();
      const mode = body?.mode === "chat" ? "chat" : "parse";
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 503);

      if (mode === "chat") {
        const weeklyGoal = Math.max(1, Number(body?.weeklyGoal) || 150);
        const today = String(body?.today || "");
        const reply = await chatWithCoach(apiKey, ctx, body?.messages, weeklyGoal, today);
        return jsonResponse({ reply });
      }

      const text = String(body?.text || "").trim();
      if (!text) return jsonResponse({ error: "text required" }, 400);
      const result = await parseExercise(apiKey, text);
      return jsonResponse({ result });
    } catch (e) {
      console.error("AI exercise parser error:", e);
      return jsonResponse({ error: e?.message || "AI request failed" }, 500);
    }
  })
);
