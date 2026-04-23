exports.handler = async function(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Missing OPENAI_API_KEY in Netlify environment variables" });
    }

    const body = JSON.parse(event.body || "{}");
    const image = body.image;

    if (!image || typeof image !== "string") {
      return json(400, { error: "Missing image data URL" });
    }

    const prompt = [
  "Read this nutrition label image carefully.",
  "Only extract values that are clearly visible in the Nutrition Facts label.",
  "Do not guess or infer a different product.",
  "If the product name is not clearly visible, return an empty string.",
  "If sodium, potassium, or phosphorus are not clearly visible, return 0 for that field.",
  "Return ONLY valid JSON with this exact shape:",
  '{"title":string,"servings":number,"sodium":number,"potassium":number,"phosphorus":number}',
  "Use mg for sodium, potassium, and phosphorus.",
  "If servings consumed is not shown, return 1.",
  "Ignore marketing text, packaging claims, and unrelated text outside the nutrition label.",
  "Do not include markdown or explanation."
].join(" ");

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
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
      return json(502, { error: "OpenAI request failed: " + text });
    }

    const data = await resp.json();
    const raw = extractText(data);

    let parsed;
    try {
      parsed = parseJson(raw);
    } catch (e) {
      return json(500, { error: "Could not parse label output: " + raw });
    }

    return json(200, {
      title: String(parsed.title || ""),
      servings: safeNumber(parsed.servings, 1),
      sodium: safeNumber(parsed.sodium, 0),
      potassium: safeNumber(parsed.potassium, 0),
      phosphorus: safeNumber(parsed.phosphorus, 0)
    });

  } catch (error) {
    return json(500, {
      error: "Function failed: " + (error instanceof Error ? error.message : String(error))
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
  return parts.join("\n").trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = String(text || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  }
}

function safeNumber(value, fallback) {
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(payload)
  };
}
