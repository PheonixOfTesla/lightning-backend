const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createPaymentIntent(amount, email) {
  return await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    receipt_email: email,
    metadata: { platform: 'lightning-pass' }
  });
}

// NEW: Update payment intent with metadata
async function updatePaymentIntent(paymentIntentId, updates) {
  return await stripe.paymentIntents.update(paymentIntentId, updates);
}

// NEW: Retrieve payment intent
async function retrievePaymentIntent(paymentIntentId) {
  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

async function createCustomer(email, phone) {
  return await stripe.customers.create({ email, phone });
}

async function processRefund(chargeId) {
  return await stripe.refunds.create({ payment_intent: chargeId });
}

module.exports = { 
  createPaymentIntent, 
  updatePaymentIntent,
  retrievePaymentIntent,
  createCustomer, 
  processRefund,
  webhooks: stripe.webhooks  // Export for webhook verification
};
