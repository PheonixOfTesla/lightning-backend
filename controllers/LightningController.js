const express = require('express');
const router = express.Router();
const Venue = require('../models/Venue');
const Pass = require('../models/Pass');
const PassTemplate = require('../models/PassTemplate');
const Transaction = require('../models/Transaction');
const LightningSauce = require('../core/Lightning-Sauce');
const stripe = require('../integrations/stripe');
const twilio = require('../integrations/twilio');
const QRCode = require('../utils/qrCode');
const mongoose = require('mongoose');
const { verifyToken, requireRole, requireVenueOwnership } = require('../middleware/auth');

// Helper function to sanitize error messages (remove API keys)
function sanitizeError(errorMessage) {
  if (!errorMessage) return 'An error occurred';
  // Remove any string that looks like an API key (sk_test_, pk_test_, sk_live_, pk_live_)
  return errorMessage
    .replace(/sk_test_[a-zA-Z0-9]+/g, 'sk_test_***')
    .replace(/pk_test_[a-zA-Z0-9]+/g, 'pk_test_***')
    .replace(/sk_live_[a-zA-Z0-9]+/g, 'sk_live_***')
    .replace(/pk_live_[a-zA-Z0-9]+/g, 'pk_live_***')
    .replace(/whsec_[a-zA-Z0-9]+/g, 'whsec_***');
}

// ==================== PUBLIC ROUTES (No auth required) ====================

// GET config - Returns public configuration (Stripe publishable key)
router.get('/config', async (req, res) => {
  try {
    res.json({
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim()
    });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET all venues - REAL DATABASE (with approval filtering)
router.get('/venues', async (req, res) => {
  try {
    const { approvalStatus, includeAll } = req.query;
    
    let filter = {};
    
    // For admin panel, include all venues
    if (includeAll === 'true') {
      // No filter, return everything
    }
    // For customer app, only show approved and active venues
    else {
      filter = { 
        isActive: true,
        $or: [
          { approvalStatus: 'approved' },
          { approvalStatus: { $exists: false } } // Legacy venues without approval status
        ]
      };
    }
    
    // Allow filtering by specific approval status
    if (approvalStatus) {
      filter.approvalStatus = approvalStatus;
    }
    
    const venues = await Venue.find(filter).lean();
    res.json({ venues });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET single venue - REAL DATABASE
router.get('/venues/:id', async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    res.json({ venue });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== PROTECTED ROUTES (Auth required) ====================

// GET venues by owner - Returns all venues owned by authenticated user
router.get('/venues/by-owner', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const venues = await Venue.find({ ownerId: req.userId }).sort({ createdAt: -1 });

    console.log(`📋 Loaded ${venues.length} venues for owner ${req.userEmail}`);

    res.json({
      success: true,
      venues
    });

  } catch (error) {
    console.error('Error loading owner venues:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST create new venue - REAL DATABASE (REQUIRES AUTH)
router.post('/venues/create', verifyToken, async (req, res) => {
  try {
    const venueData = req.body;
    
    // Set owner to current user
    venueData.ownerId = req.userId;
    
    // New venues start as pending
    if (!venueData.approvalStatus) {
      venueData.approvalStatus = 'pending';
    }
    
    // Create new venue
    const newVenue = new Venue(venueData);
    await newVenue.save();

    // Update the user's venueId only if they don't have one yet (first venue)
    const User = require('../models/User');
    const user = await User.findById(req.userId);

    if (!user.venueId) {
      await User.findByIdAndUpdate(req.userId, {
        venueId: newVenue._id,
        role: 'venue'  // Ensure they have venue role
      });
      console.log(`✅ User ${req.userEmail} linked to first venue ${newVenue._id}`);
    } else {
      console.log(`✅ Additional venue created for ${req.userEmail} (Total venues: ${await Venue.countDocuments({ ownerId: req.userId })})`);
    }

    console.log(`✅ New venue created: ${newVenue.name} (Status: ${newVenue.approvalStatus || 'pending'}) by ${req.userEmail}`);
    
    res.json({ 
      success: true, 
      message: newVenue.approvalStatus === 'pending' 
        ? 'Venue application submitted for review' 
        : 'Venue created successfully',
      venue: newVenue,
      // Return updated venueId so frontend can use it
      venueId: newVenue._id.toString()
    });
    
  } catch (error) {
    console.error('Error creating venue:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST approve/reject venue - ADMIN ONLY
router.post('/venue/approve', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { venueId, approvalStatus, rejectionReason } = req.body;
    
    if (!['approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.approvalStatus = approvalStatus;
    
   if (approvalStatus === 'approved') {
  venue.approvedAt = new Date();
  venue.approvedBy = req.userEmail || 'admin';
  
  console.log(`✅ Venue APPROVED: ${venue.name} by ${req.userEmail}`);
  
  // Link the venue to its owner's user account
  if (venue.ownerId) {
    const User = require('../models/User');
    await User.findByIdAndUpdate(venue.ownerId, {
      venueId: venue._id,
      role: 'venue'
    });
    console.log(`✅ User ${venue.ownerId} linked to approved venue ${venue._id}`);
  }
  
  // TODO: Send approval email to venue owner with login credentials
  // await sendApprovalEmail(venue);
  
} else if (approvalStatus === 'rejected') {
  venue.rejectedAt = new Date();
  venue.rejectionReason = rejectionReason || 'Application did not meet requirements';
  
  console.log(`❌ Venue REJECTED: ${venue.name} by ${req.userEmail}`);
      
      // TODO: Send rejection email to venue owner
      // await sendRejectionEmail(venue);
    }
    
    await venue.save();
    
    res.json({ 
      success: true, 
      message: `Venue ${approvalStatus}`,
      venue 
    });
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// DELETE venue - ADMIN ONLY
router.delete('/venues/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Optional: Check if venue has active passes before deleting
    const activePasses = await Pass.countDocuments({ 
      venueId: req.params.id, 
      status: 'active' 
    });
    
    if (activePasses > 0) {
      return res.status(400).json({ 
        error: `Cannot delete venue with ${activePasses} active passes. Please wait for passes to expire or contact support.`,
        activePasses 
      });
    }
    
    await Venue.findByIdAndDelete(req.params.id);
    
    console.log(`🗑️ Venue DELETED: ${venue.name} by ${req.userEmail}`);
    
    res.json({ 
      success: true, 
      message: 'Venue deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== FIXED PAYMENT FLOW ====================

// STEP 1: Create payment intent (DON'T create pass yet!)
router.post('/passes/create-payment', async (req, res) => {
  try {
    const { venueId, email, phone, numPasses, templateId } = req.body;

    // Validate input
    if (!venueId || !email || !phone || !numPasses) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (numPasses < 1 || numPasses > 10) {
      return res.status(400).json({ error: 'Invalid number of passes (1-10)' });
    }

    // Get venue
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Check venue is approved and active
    if (venue.approvalStatus && venue.approvalStatus !== 'approved') {
      return res.status(400).json({ error: 'Venue is not accepting passes at this time' });
    }

    if (!venue.isActive) {
      return res.status(400).json({ error: 'Venue passes not active' });
    }

    // Check availability
    if (venue.availablePasses < numPasses) {
      return res.status(400).json({ error: 'Not enough passes available' });
    }

    // Get pass template if provided, otherwise use venue's current price
    let price = venue.currentPrice;
    let passName = 'General Admission';
    let passDescription = '';
    let tagline = '';

    if (templateId) {
      const template = await PassTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({ error: 'Pass template not found' });
      }
      if (!template.isActive) {
        return res.status(400).json({ error: 'This pass type is not available' });
      }
      price = template.price;
      passName = template.name;
      passDescription = template.description || '';
      tagline = template.tagline || '';
    }

    // Calculate amount
    const amount = price * numPasses;
    const amountCents = Math.round(amount * 100);

    // Create payment intent with automatic split if venue has Stripe Connect
    const paymentIntent = await stripe.createPaymentIntent(
      amountCents,
      email,
      venue.stripeConnectId  // Automatically splits 85% to venue, 15% to platform
    );

    // Store payment intent metadata for later
    await stripe.updatePaymentIntent(paymentIntent.id, {
      metadata: {
        venueId: venue._id.toString(),
        venueName: venue.name,
        email,
        phone,
        numPasses: numPasses.toString(),
        amount: amount.toString(),
        templateId: templateId || '',
        passName,
        passDescription,
        tagline
      }
    });

    console.log(`💳 Payment intent created: ${paymentIntent.id} for ${venue.name} - ${passName} x${numPasses}`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// STEP 2: After payment succeeds, create the pass
router.post('/passes/confirm-payment', async (req, res) => {
  try {
    const { paymentIntentId, email, phone } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }
    
    // Retrieve payment intent from Stripe
    let paymentIntent = await stripe.retrievePaymentIntent(paymentIntentId);

    // For test mode: auto-confirm payment intents that need confirmation
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_confirmation') {
      try {
        // Auto-confirm with test payment method in test mode
        paymentIntent = await stripe.confirmPaymentIntent(paymentIntentId, 'pm_card_visa');
        console.log(`💳 Test payment auto-confirmed: ${paymentIntentId}`);
      } catch (confirmError) {
        console.error('Auto-confirm failed:', confirmError.message);
      }
    }

    // Verify payment succeeded
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: 'Payment not completed',
        status: paymentIntent.status,
        hint: 'Payment requires confirmation with a valid payment method'
      });
    }
    
    // Check if pass already created (idempotency)
    const existingPass = await Pass.findOne({ 
      stripePaymentIntentId: paymentIntentId 
    });
    
    if (existingPass) {
      console.log(`✅ Pass already exists: ${existingPass.passId}`);
      return res.json({
        success: true,
        passId: existingPass.passId,
        pass: existingPass,
        message: 'Pass already created'
      });
    }
    
    // Get metadata
    const {
      venueId,
      venueName,
      numPasses,
      amount,
      templateId,
      passName,
      passDescription,
      tagline
    } = paymentIntent.metadata;

    // Get venue
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Generate pass with unique ID
    const passId = `LP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const qrCodeData = await QRCode.generate(passId);

    // Create pass with template information
    const newPass = new Pass({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      purchasePrice: parseFloat(amount) / parseInt(numPasses),
      quantity: parseInt(numPasses),
      amount: parseFloat(amount),
      qrCode: qrCodeData,
      status: 'active',
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      stripePaymentIntentId: paymentIntentId,
      // Template information
      templateId: templateId || null,
      passName: passName || 'General Admission',
      passDescription: passDescription || '',
      tagline: tagline || ''
    });
    
    await newPass.save();
    
    // Create transaction
    const transaction = new Transaction({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      amount: parseFloat(amount),
      venueRevenue: parseFloat(amount) * 0.85,
      platformFee: parseFloat(amount) * 0.15,
      stripeChargeId: paymentIntentId,
      status: 'completed'
    });
    
    await transaction.save();
    
    // Update venue and track pending payout
    venue.availablePasses -= parseInt(numPasses);
    venue.inLine += parseInt(numPasses);
    venue.pendingPayout = (venue.pendingPayout || 0) + (parseFloat(amount) * 0.85); // Track 85% for venue
    await venue.save();
    
    console.log(`✅ Pass created after payment: ${passId} for ${venue.name}`);
    
    // Send confirmation SMS
    try {
      await twilio.sendPassConfirmation(phone, venue, newPass);
    } catch (smsError) {
      console.error('SMS send failed:', smsError);
      // Don't fail the request if SMS fails
    }
    
    res.json({
      success: true,
      passId,
      pass: newPass
    });
    
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Stripe Webhook Handler
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ Payment succeeded:', paymentIntent.id);
      
      // Pass is created via confirm-payment endpoint
      // This is just for logging/monitoring
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ Payment failed:', failedPayment.id);
      
      // Could send notification to customer
      break;
      
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// ==================== PASS VALIDATION & USAGE (Scanner Routes) ====================

// GET validate pass - SCANNER ONLY (REQUIRES AUTH)
router.get('/passes/:passId/validate', verifyToken, requireRole('venue', 'admin', 'scanner'), async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });
    
    if (!pass) {
      return res.status(404).json({ valid: false, error: 'Pass not found' });
    }
    
    if (pass.status !== 'active') {
      return res.status(400).json({ valid: false, error: 'Pass already used or expired' });
    }
    
    if (pass.validUntil && new Date() > pass.validUntil) {
      pass.status = 'expired';
      await pass.save();
      return res.status(400).json({ valid: false, error: 'Pass expired' });
    }
    
    res.json({ valid: true, pass });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST use pass - SCANNER ONLY (REQUIRES AUTH)
router.post('/passes/:passId/use', verifyToken, requireRole('venue', 'admin', 'scanner'), async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });
    
    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }
    
    if (pass.status !== 'active') {
      return res.status(400).json({ error: 'Pass already used or expired' });
    }
    
    // Mark pass as used
    pass.status = 'used';
    pass.usedAt = new Date();
    pass.usedBy = req.userEmail;  // Track who scanned it
    await pass.save();
    
    // Update venue stats
    await Venue.findByIdAndUpdate(pass.venueId, {
      $inc: { inLine: -pass.quantity }
    });
    
    console.log(`✅ Pass USED: ${pass.passId} by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Pass used successfully' });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== VENUE MANAGEMENT (Owner Routes) ====================

// PUT update venue pricing - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.put('/venue/pricing', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, newPrice } = req.body;
    
    if (!newPrice || newPrice < 10 || newPrice > 500) {
      return res.status(400).json({ error: 'Price must be between $10 and $500' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.currentPrice = newPrice;
    await venue.save();
    
    console.log(`💰 Price updated: ${venue.name} to $${newPrice} by ${req.userEmail}`);
    
    res.json({ success: true, newPrice });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST activate passes - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/venue/activate', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, availablePasses } = req.body;
    
    if (availablePasses < 0 || availablePasses > 500) {
      return res.status(400).json({ error: 'Passes must be between 0 and 500' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = true;
    venue.availablePasses = availablePasses;
    await venue.save();
    
    console.log(`⚡ Passes activated: ${venue.name} (${availablePasses} passes) by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Passes activated' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST deactivate passes - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/venue/deactivate', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = false;
    await venue.save();
    
    console.log(`❌ Passes deactivated: ${venue.name} by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Passes deactivated' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET venue stats - VENUE OWNER or ADMIN (REQUIRES AUTH) - FIXED WITH AGGREGATION
router.get('/venue/:venueId/stats', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Get today's transactions using FIXED aggregation (no more N+1 queries!)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const stats = await Transaction.aggregate([
      {
        $match: {
          venueId: new mongoose.Types.ObjectId(req.params.venueId),
          createdAt: { $gte: startOfDay }
        }
      },
      {
        $lookup: {
          from: 'passes',
          localField: 'passId',
          foreignField: 'passId',
          as: 'pass'
        }
      },
      {
        $unwind: { path: '$pass', preserveNullAndEmptyArrays: true }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$venueRevenue' },
          passesSold: { $sum: { $ifNull: ['$pass.quantity', 0] } }
        }
      }
    ]);
    
    const result = stats[0] || { revenue: 0, passesSold: 0 };
    
    res.json({
      revenue: Math.round(result.revenue),
      passesSold: result.passesSold,
      currentWait: venue.waitTime,
      inLine: venue.inLine
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST push notification - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/notifications/push', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, message, radius } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // TODO: Find users within radius and send notifications
    
    res.json({ success: true, sent: 0, message: 'Feature coming soon' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET pricing suggestion - PUBLIC OR AUTH (Works either way)
router.get('/pricing/ml-suggest', async (req, res) => {
  try {
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const suggestion = LightningSauce.calculateOptimalPrice(
      venue,
      venue.waitTime,
      venue.capacity
    );

    res.json(suggestion);
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== STRIPE CONNECT & PAYOUTS ====================

// POST create Stripe Connect account for venue
router.post('/venue/connect/create', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, email } = req.body;

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    if (venue.stripeConnectId) {
      return res.status(400).json({ error: 'Venue already has Stripe Connect account' });
    }

    const account = await stripe.createConnectAccount(email, venue.name);
    venue.stripeConnectId = account.id;
    await venue.save();

    const accountLink = await stripe.createConnectAccountLink(
      account.id,
      `${process.env.FRONTEND_URL}/venue/connect/refresh`,
      `${process.env.FRONTEND_URL}/venue/connect/return`
    );

    console.log(`✅ Stripe Connect created for ${venue.name}`);

    res.json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url
    });

  } catch (error) {
    console.error('Connect account creation error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST trigger payout for venue
router.post('/venue/payout', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId } = req.body;

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    if (!venue.stripeConnectId) {
      return res.status(400).json({ error: 'Venue must connect Stripe account first' });
    }

    if (venue.pendingPayout <= 0) {
      return res.status(400).json({ error: 'No pending payout' });
    }

    // Create Stripe transfer
    const transfer = await stripe.createPayout(venue.stripeConnectId, venue.pendingPayout);

    // Update venue
    const paidAmount = venue.pendingPayout;
    venue.totalPaidOut = (venue.totalPaidOut || 0) + paidAmount;
    venue.lastPayoutAt = new Date();
    venue.pendingPayout = 0;
    await venue.save();

    console.log(`💸 Payout sent to ${venue.name}: $${paidAmount.toFixed(2)}`);

    res.json({
      success: true,
      amountPaid: paidAmount,
      transferId: transfer.id
    });

  } catch (error) {
    console.error('Payout error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST trigger end-of-night payouts for ALL venues - ADMIN ONLY
router.post('/admin/payout-all', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const venues = await Venue.find({
      pendingPayout: { $gt: 0 },
      stripeConnectId: { $exists: true, $ne: null }
    });

    const results = [];
    let totalPaidOut = 0;

    for (const venue of venues) {
      try {
        const transfer = await stripe.createPayout(venue.stripeConnectId, venue.pendingPayout);

        const paidAmount = venue.pendingPayout;
        venue.totalPaidOut = (venue.totalPaidOut || 0) + paidAmount;
        venue.lastPayoutAt = new Date();
        venue.pendingPayout = 0;
        await venue.save();

        totalPaidOut += paidAmount;

        results.push({
          venueId: venue._id,
          venueName: venue.name,
          amountPaid: paidAmount,
          success: true
        });

        console.log(`💸 Payout sent to ${venue.name}: $${paidAmount.toFixed(2)}`);
      } catch (error) {
        results.push({
          venueId: venue._id,
          venueName: venue.name,
          error: error.message,
          success: false
        });
        console.error(`❌ Payout failed for ${venue.name}:`, error.message);
      }
    }

    console.log(`✅ End-of-night payouts completed: ${results.filter(r => r.success).length}/${venues.length} venues, $${totalPaidOut.toFixed(2)} total`);

    res.json({
      success: true,
      venuesPaid: results.filter(r => r.success).length,
      totalVenues: venues.length,
      totalPaidOut,
      results
    });

  } catch (error) {
    console.error('Bulk payout error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET venue payout info
router.get('/venue/:venueId/payout-info', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({
      pendingPayout: venue.pendingPayout || 0,
      totalPaidOut: venue.totalPaidOut || 0,
      lastPayoutAt: venue.lastPayoutAt,
      hasStripeConnect: !!venue.stripeConnectId,
      stripeConnectId: venue.stripeConnectId
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== PASS TEMPLATES ====================

// POST create pass template - VENUE OWNER or ADMIN
router.post('/venue/:venueId/pass-templates', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { name, description, price, tagline, features } = req.body;
    const { venueId } = req.params;

    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const passTemplate = new PassTemplate({
      venueId: venue._id,
      venueName: venue.name,
      name,
      description,
      price,
      tagline,
      features: features || [],
      isActive: true
    });

    await passTemplate.save();

    console.log(`✅ Pass template created: ${name} for ${venue.name} ($${price})`);

    res.json({
      success: true,
      template: passTemplate
    });

  } catch (error) {
    console.error('Create pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET all pass templates for a venue - VENUE OWNER or ADMIN
router.get('/venue/:venueId/pass-templates', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const templates = await PassTemplate.find({ venueId: req.params.venueId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET public pass templates for a venue (for customer purchase)
router.get('/venues/:venueId/pass-templates', async (req, res) => {
  try {
    const templates = await PassTemplate.find({
      venueId: req.params.venueId,
      isActive: true
    }).sort({ price: 1 });

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// PUT update pass template - VENUE OWNER or ADMIN
router.put('/venue/:venueId/pass-templates/:templateId', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { name, description, price, tagline, features, isActive } = req.body;
    const { templateId } = req.params;

    const template = await PassTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    if (price) template.price = price;
    if (tagline !== undefined) template.tagline = tagline;
    if (features !== undefined) template.features = features;
    if (isActive !== undefined) template.isActive = isActive;

    await template.save();

    console.log(`✅ Pass template updated: ${template.name}`);

    res.json({
      success: true,
      template
    });

  } catch (error) {
    console.error('Update pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// DELETE pass template - VENUE OWNER or ADMIN
router.delete('/venue/:venueId/pass-templates/:templateId', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { templateId } = req.params;

    const template = await PassTemplate.findByIdAndDelete(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    console.log(`✅ Pass template deleted: ${template.name}`);

    res.json({
      success: true,
      message: 'Template deleted'
    });

  } catch (error) {
    console.error('Delete pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

module.exports = router;
