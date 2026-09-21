import { withSupabase } from "npm:@supabase/server@0.6.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(
  withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    try {
      const body = await req.json();
      const text = String(body?.text || "").trim();
      if (!text) return Response.json({ error: "text required" }, { status: 400, headers: cors });

      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503, headers: cors });

      const prompt = `운동기록 앱의 자연어 입력을 구조화하세요.
입력: ${text}

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
- 날짜가 없으면 오늘.
- 시간은 분 단위 number. 명시되지 않으면 null.
- 세트 수가 있으면 sets number, 없으면 null.
- 페이스가 있으면 MM:SS 문자열, 없으면 null.
- note에는 원문을 그대로 넣으세요.
- 확실하지 않으면 임의로 housework로 몰지 말고 가장 가까운 운동 종류를 선택하세요.`;

      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: [
            { role: "system", content: "You are a precise Korean exercise-log parser. Return JSON only." },
            { role: "user", content: prompt }
          ],
          text: { format: { type: "json_object" } },
          max_output_tokens: 300
        })
      });

      const data = await resp.json();
      if (!resp.ok) return Response.json({ error: data?.error?.message || "OpenAI request failed" }, { status: 502, headers: cors });

      const output = data?.output_text || data?.output?.map(x => x.content?.map(y => y.text || "").join("")).join("") || "";
      const result = JSON.parse(output);
      return Response.json({ result }, { headers: cors });
    } catch (e) {
      return Response.json({ error: e?.message || "AI parser failed" }, { status: 500, headers: cors });
    }
  })
);
