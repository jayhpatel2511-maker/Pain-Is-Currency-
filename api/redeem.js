// POST /api/redeem  { reward: "discount10" | "discount25" | "workbook", uid, email }
// Every redemption delivers something REAL:
//  - discount10 / discount25 -> a unique single-use Stripe promotion code,
//    created live on the connected Stripe account.
//  - workbook -> a signed, expiring download link for the actual PDF.
// (The Premium Mission Pack unlock is delivered in-app via the user's profile.)
import { json, stripeGet, stripePost, makeGrant } from "./_lib.js";

const DISCOUNTS = {
  discount10: { couponId: "PIC_REWARD_10", percent: 10, label: "10% off" },
  discount25: { couponId: "PIC_REWARD_25", percent: 25, label: "25% off" }
};

async function ensureCoupon(def) {
  try {
    await stripeGet(`/coupons/${def.couponId}`);
  } catch (err) {
    if (err.code === "resource_missing") {
      await stripePost("/coupons", {
        id: def.couponId,
        percent_off: def.percent,
        duration: "once",
        name: `PAIN Token Reward — ${def.label}`
      });
    } else {
      throw err;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const { reward, uid } = req.body || {};
    if (!uid || typeof uid !== "string" || uid.length < 6) {
      return json(res, 400, { error: "A logged-in account is required to redeem rewards." });
    }

    if (reward === "workbook") {
      const grant = makeGrant({ item: "workbook", uid }, 60 * 60 * 24 * 7);
      return json(res, 200, {
        type: "download",
        url: `/api/download?grant=${encodeURIComponent(grant)}`,
        note: "Your workbook link is ready and stays valid for 7 days."
      });
    }

    const def = DISCOUNTS[reward];
    if (!def) return json(res, 400, { error: "Unknown reward." });

    await ensureCoupon(def);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const code = `PIC${def.percent}-${suffix}`;
    const promo = await stripePost("/promotion_codes", {
      coupon: def.couponId,
      code,
      max_redemptions: 1,
      "metadata[uid]": uid,
      "metadata[source]": "reward_vault"
    });

    return json(res, 200, {
      type: "promo_code",
      code: promo.code,
      percent: def.percent,
      note: `Real Stripe discount code created. Enter it at checkout for ${def.label} — single use, just for you.`
    });
  } catch (err) {
    const status = err.code === "MISSING_ENV" ? 503 : 500;
    return json(res, status, { error: err.message });
  }
}
