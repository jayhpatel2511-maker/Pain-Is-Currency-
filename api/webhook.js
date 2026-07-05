// POST /api/webhook — Stripe webhook receiver.
// Acknowledges checkout.session.completed events. Delivery itself is pull-based
// (thank-you page verifies the session with Stripe), so this endpoint is for
// logging/observability and future automation (e.g. custom emails).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const event = req.body || {};
    if (event.type === "checkout.session.completed") {
      console.log("Checkout completed:", event.data?.object?.id, event.data?.object?.customer_details?.email);
    }
    res.status(200).json({ received: true });
  } catch {
    res.status(200).json({ received: true });
  }
}
