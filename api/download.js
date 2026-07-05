// GET /api/download?session_id=cs_...   (paid Stripe checkout)
// GET /api/download?grant=<signed token> (reward vault redemption)
// Streams the workbook PDF ONLY after verification. The PDF is not
// publicly reachable anywhere else on the site.
import fs from "node:fs";
import path from "node:path";
import { json, verifyPaidSession, readGrant } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  try {
    let authorized = false;
    let who = "";

    if (req.query.session_id) {
      const result = await verifyPaidSession(req.query.session_id);
      if (result.paid) {
        authorized = true;
        who = result.email || "buyer";
      } else {
        return json(res, 402, { error: "Payment not verified. " + result.reason });
      }
    } else if (req.query.grant) {
      const grant = readGrant(req.query.grant);
      if (grant && grant.item === "workbook") {
        authorized = true;
        who = grant.uid || "reward";
      } else {
        return json(res, 403, { error: "This download link is invalid or has expired." });
      }
    }

    if (!authorized) {
      return json(res, 401, { error: "A verified purchase or reward redemption is required to download the workbook." });
    }

    const filePath = path.join(process.cwd(), "api", "_files", "workbook.pdf");
    const file = fs.readFileSync(filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="30-Day-Confidence-Reset-Workbook.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Delivered-To", String(who).slice(0, 100));
    res.status(200).send(file);
  } catch (err) {
    const status = err.code === "MISSING_ENV" ? 503 : 500;
    return json(res, status, { error: err.message });
  }
}
