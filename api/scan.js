// POST /api/scan
// Body: { image: base64 (no data: prefix), mimeType, description, uid, recentHashes: [] }
// Real AI vision via Google Gemini. The model looks at the photo, identifies
// what it shows, cross-checks it against the written proof, screens for
// cheating (screenshots of screens, stock/AI images, mismatches, re-used
// shots) and awards 0-160 PAIN tokens. All scoring happens server-side so
// the browser can never fake a verdict.
import { json, requireEnv, sha256Hex } from "./_lib.js";

export const config = { api: { bodyParser: { sizeLimit: "6mb" } } };

const SYSTEM_PROMPT = `You are the strict proof verifier for "Pain Is Currency", a discipline-building app where users (including kids) upload a photo proving they completed real effort (workout, studying, coding, chores, reading, creative work, sports practice, etc.) and earn PAIN tokens.

Analyze the attached photo together with the user's written description.

SCORING (tokens):
- 0: reject - photo doesn't show real personal effort, doesn't match the description, or shows cheating signs.
- 20-40: small but real effort with light evidence.
- 45-80: clear completed task, photo clearly matches the description.
- 85-120: hard effort with visible time/quantity/measurable result.
- 125-160: exceptional, unmistakable effort with strong visible proof.

CHEATING SIGNALS - award 0 and set fraudRisk "high" if you detect:
- A photo of another screen/monitor/phone displaying content (unless the task itself is digital work, in which case a direct screenshot is fine but a photo-of-a-screen is suspicious).
- Stock photos, magazine/web images, professional photography, AI-generated images, or images with watermarks.
- The photo has nothing to do with the written description.
- A generic object photo with no evidence of effort (e.g. a photo of closed textbooks claimed as "studied 3 hours" with no notes/work visible).
- Text description that is copy-paste filler, spam, or unrelated to the image.

Be fair to genuine effort: phone photos of messy desks, handwritten notes, sweaty gym selfies, sports fields, half-finished chores are exactly what real proof looks like. Do not reject just because a photo is imperfect.

Respond with ONLY this JSON, no markdown fences:
{"valid": boolean, "itemDetected": "short description of what the photo actually shows", "category": one of "fitness"|"study"|"coding"|"chores"|"creative"|"sports"|"business"|"other", "tokens": integer 0-160, "confidence": integer 0-100, "fraudRisk": "low"|"medium"|"high", "reason": "1-2 sentence kid-friendly explanation of the verdict"}`;

// Supports both key types:
//  - Standard Gemini API keys (AIza...) -> generativelanguage.googleapis.com
//  - Vertex AI express keys (AQ....)    -> aiplatform.googleapis.com
async function callGemini(apiKey, model, body) {
  const endpoints = [];
  const glUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const vxUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  if (apiKey.startsWith("AQ.")) { endpoints.push(vxUrl, glUrl); } else { endpoints.push(glUrl, vxUrl); }

  let lastErr = null;
  for (const url of endpoints) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    lastErr = data?.error?.message || `Gemini error ${r.status}`;
    // Only fall through to the next endpoint on auth/permission style errors.
    if (![400, 401, 403, 404].includes(r.status)) break;
  }
  const err = new Error(lastErr || "Gemini request failed");
  err.gemini = true;
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  let apiKey;
  try {
    apiKey = requireEnv("GEMINI_API_KEY");
  } catch (err) {
    return json(res, 503, { error: err.message, setupNeeded: true });
  }

  try {
    const { image, mimeType, description, recentHashes } = req.body || {};

    // --- Server-side gates (cannot be bypassed by editing browser JS) ---
    if (!image || typeof image !== "string") return reject(res, "No image received.");
    const imgBytes = Buffer.from(image, "base64");
    if (imgBytes.length < 25_000) return reject(res, "Image is too small to be real proof. Take a full photo with your camera.");
    if (imgBytes.length > 5_500_000) return reject(res, "Image is too large. Please retake or compress it.");
    const desc = String(description || "").trim();
    if (desc.length < 40) return reject(res, "Write at least a couple of sentences describing exactly what you did.");
    if (/(.)\1{9,}/.test(desc)) return reject(res, "Description looks like spam.");

    // Duplicate detection: hash computed on the server.
    const hash = sha256Hex(imgBytes);
    if (Array.isArray(recentHashes) && recentHashes.includes(hash)) {
      return json(res, 200, {
        valid: false, tokens: 0, itemDetected: "duplicate image", category: "other",
        confidence: 100, fraudRisk: "high", imageHash: hash,
        reason: "This exact photo was already submitted. Every proof needs a brand new photo."
      });
    }

    const mt = /^image\/(jpeg|png|webp|heic|heif)$/.test(String(mimeType)) ? mimeType : "image/jpeg";
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    let data;
    try {
      data = await callGemini(apiKey, model, {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mt, data: image } },
            { text: `User's written proof description:\n"""${desc.slice(0, 2000)}"""` }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: "application/json" }
      });
    } catch (err) {
      return json(res, 502, { error: "AI vision is temporarily unavailable: " + err.message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    let verdict;
    try {
      verdict = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      return json(res, 502, { error: "AI returned an unreadable verdict. Please try again." });
    }

    // --- Server-side clamps: the model's output is bounded, never trusted raw ---
    let tokens = Math.round(Number(verdict.tokens) || 0);
    tokens = Math.max(0, Math.min(160, tokens));
    const valid = Boolean(verdict.valid) && tokens > 0 && verdict.fraudRisk !== "high";
    if (!valid) tokens = 0;

    return json(res, 200, {
      valid,
      tokens,
      itemDetected: String(verdict.itemDetected || "unknown").slice(0, 140),
      category: String(verdict.category || "other").slice(0, 20),
      confidence: Math.max(0, Math.min(100, Math.round(Number(verdict.confidence) || 0))),
      fraudRisk: ["low", "medium", "high"].includes(verdict.fraudRisk) ? verdict.fraudRisk : "medium",
      reason: String(verdict.reason || "Verdict complete.").slice(0, 400),
      imageHash: hash,
      mode: "gemini_vision"
    });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}

function reject(res, reason) {
  return json(res, 200, {
    valid: false, tokens: 0, itemDetected: "rejected before AI review", category: "other",
    confidence: 100, fraudRisk: "high", reason
  });
}
