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

// STRIPE CONNECT & PAYOUT FUNCTIONS
async function createConnectAccount(email, businessName) {
  return await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email,
    business_type: 'company',
    company: { name: businessName },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    }
  });
}

async function createConnectAccountLink(accountId, refreshUrl, returnUrl) {
  return await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });
}

async function createPayout(connectAccountId, amount) {
  return await stripe.transfers.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    destination: connectAccountId,
    description: 'End of night payout - Lightning Pass'
  });
}

module.exports = {
  createPaymentIntent,
  updatePaymentIntent,
  retrievePaymentIntent,
  createCustomer,
  processRefund,
  createConnectAccount,
  createConnectAccountLink,
  createPayout,
  webhooks: stripe.webhooks  // Export for webhook verification
};
