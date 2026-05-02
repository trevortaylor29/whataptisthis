import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { addPaidCredits } from "@/lib/visitor-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !secretKey) {
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new NextResponse("Missing stripe-signature", { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid payload";
    return new NextResponse(`Webhook signature verification failed: ${msg}`, {
      status: 400,
    });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const fingerprint = session.metadata?.fingerprint?.trim();
    if (fingerprint && session.id) {
      const email =
        session.customer_details?.email ??
        (typeof session.customer_email === "string"
          ? session.customer_email
          : null);
      await addPaidCredits(fingerprint, 5, session.id, email);
    }
  }

  return new NextResponse(null, { status: 200 });
}
