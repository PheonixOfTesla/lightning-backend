const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createPaymentIntent(amount, email) {
  return await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    receipt_email: email,
    metadata: { platform: 'lightning-pass' }
  });
}

async function createCustomer(email, phone) {
  return await stripe.customers.create({ email, phone });
}

async function processRefund(chargeId) {
  return await stripe.refunds.create({ payment_intent: chargeId });
}

module.exports = { createPaymentIntent, createCustomer, processRefund };
