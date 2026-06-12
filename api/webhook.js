export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const event = req.body;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const email = session.customer_details?.email;
    const amount = session.amount_total;

    let productLink = "";

    if (amount === 1999) {
      productLink = "https://your-link.com/ebook.pdf";
    }

    if (amount === 3999) {
      productLink = "https://your-link.com/workbook.pdf";
    }

    console.log("Send product to:", email, productLink);
  }

  res.status(200).json({ received: true });
}
