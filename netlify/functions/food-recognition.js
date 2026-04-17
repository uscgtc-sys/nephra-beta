export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Missing OPENAI_API_KEY in Netlify environment variables" });
    }

    const body = await req.json();
    const image = body.image;

    if (!image || typeof image !== "string") {
      return json(400, { error: "Missing image data URL" });
    }

    const prompt = [
      "You are a renal nutrition assistant for CKD stage 3-5 non-dialysis users.",
      "Analyze this meal photo and return only valid JSON.",
      'Use this exact shape: {"title":string,"sodium":number,"potassium":number,"phosphorus":number,"confidence":string,"notes":string,"source":string}',
      "Estimate one serving conservatively. No markdown fences."
    ].join(" ");

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: image }
            ]
          }
        ],
        max_output_tokens: 500
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return json(502, { error: "OpenAI request failed", details: text });
    }

    const data = await resp.json();
    const raw = extractText(data);
    let parsed;

try {
  parsed = parseJson(raw);
} catch (e) {
  parsed = {
    title: raw?.slice(0, 50) || "Recognized meal",
    sodium: 500,
    potassium: 500,
    phosphorus: 200,
    confidence: "Low",
    notes: "AI response was not structured. Using fallback.",
    source: "AI fallback"
  };
}

    return json(200, {
      title: String(parsed.title || "Recognized meal"),
      sodium: safeNumber(parsed.sodium),
      potassium: safeNumber(parsed.potassium),
      phosphorus: safeNumber(parsed.phosphorus),
      confidence: String(parsed.confidence || "Moderate"),
      notes: String(parsed.notes || "Recognized from food photo. Review before relying on it."),
      source: String(parsed.source || "Prepared food recognition")
    });
  } catch (error) {
    return json(500, {
      error: "Function failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

function extractText(responseJson) {
  if (typeof responseJson?.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const output = responseJson?.output;
  if (!Array.isArray(output)) return "";

  const parts = [];
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const c of item.content) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\\n").trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = String(text || "")
      .replace(/^```json\\s*/i, "")
      .replace(/^```\\s*/i, "")
      .replace(/```\\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  }
}

function safeNumber(value) {
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function json(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
}
