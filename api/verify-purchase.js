// GET /api/verify-purchase?session_id=cs_...
// Confirms with Stripe that the checkout session was actually paid.
import { json, verifyPaidSession } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const result = await verifyPaidSession(req.query.session_id);
    if (!result.paid) return json(res, 402, { paid: false, reason: result.reason });
    return json(res, 200, {
      paid: true,
      email: result.email,
      amount_total: result.amount_total,
      currency: result.currency
    });
  } catch (err) {
    const status = err.code === "MISSING_ENV" ? 503 : 500;
    return json(res, status, { paid: false, error: err.message });
  }
}
