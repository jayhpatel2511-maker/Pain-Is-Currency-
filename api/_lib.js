// Shared helpers for Pain Is Currency serverless functions.
import crypto from "node:crypto";

export function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.json(body);
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing environment variable ${name}. Add it in Vercel > Project > Settings > Environment Variables, then redeploy.`);
    err.code = "MISSING_ENV";
    throw err;
  }
  return v;
}

// ---- Stripe (plain REST, no SDK needed) ----
export async function stripeGet(path) {
  const key = requireEnv("STRIPE_SECRET_KEY");
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error(data?.error?.message || `Stripe error ${r.status}`);
    err.code = data?.error?.code || "stripe_error";
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function stripePost(path, params) {
  const key = requireEnv("STRIPE_SECRET_KEY");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error(data?.error?.message || `Stripe error ${r.status}`);
    err.code = data?.error?.code || "stripe_error";
    err.status = r.status;
    throw err;
  }
  return data;
}

// Verifies a Checkout Session is actually paid. Returns normalized info.
export async function verifyPaidSession(sessionId) {
  if (!sessionId || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return { paid: false, reason: "Invalid or missing checkout session id." };
  }
  const s = await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const paid = s.payment_status === "paid" || s.status === "complete";
  return {
    paid,
    reason: paid ? "Payment verified." : `Payment not completed (status: ${s.payment_status}).`,
    email: s.customer_details?.email || s.customer_email || null,
    amount_total: s.amount_total,
    currency: s.currency,
    created: s.created
  };
}

// ---- Signed download grants (HMAC, keyed off the Stripe secret) ----
function grantKey() {
  return crypto.createHash("sha256").update("pic-grant:" + requireEnv("STRIPE_SECRET_KEY")).digest();
}

export function makeGrant(payload, ttlSeconds = 60 * 60 * 24 * 7) {
  const data = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const b64 = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", grantKey()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function readGrant(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", grantKey()).update(b64).digest("base64url");
  const a = Buffer.from(sig || "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
