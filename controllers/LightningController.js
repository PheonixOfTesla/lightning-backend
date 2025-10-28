const express = require('express');
const router = express.Router();
const Venue = require('../models/Venue');
const Pass = require('../models/Pass');
const Transaction = require('../models/Transaction');
const LightningSauce = require('../core/Lightning-Sauce');
const stripe = require('../integrations/stripe');
const twilio = require('../integrations/twilio');
const QRCode = require('../utils/qrCode');

// GET all venues - REAL DATABASE
router.get('/venues', async (req, res) => {
  try {
    const venues = await Venue.find({ isActive: true }).lean();
    res.json({ venues });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// POST purchase pass - REAL DATABASE
router.post('/passes/purchase', async (req, res) => {
  try {
    const { venueId, email, phone, numPasses } = req.body;
    
    // 1. Get venue from database
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    if (!venue.isActive) {
      return res.status(400).json({ error: 'Venue passes not active' });
    }
    
    if (venue.availablePasses < numPasses) {
      return res.status(400).json({ error: 'Not enough passes available' });
    }
    
    const amount = venue.currentPrice * numPasses;
    const amountCents = Math.round(amount * 100);
    
    // 2. Create Stripe payment
    const paymentIntent = await stripe.createPaymentIntent(amountCents, email);
    
    // 3. Generate pass
    const passId = `LP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const qrCodeData = await QRCode.generate(passId);
    
    // 4. Save pass to database
    const newPass = new Pass({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      purchasePrice: venue.currentPrice,
      quantity: numPasses,
      amount,
      qrCode: qrCodeData,
      status: 'active',
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    
    await newPass.save();
    
    // 5. Save transaction to database
    const transaction = new Transaction({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      amount,
      venueRevenue: amount * 0.7,
      platformFee: amount * 0.3,
      stripeChargeId: paymentIntent.id,
      status: 'completed'
    });
    
    await transaction.save();
    
    // 6. Update venue available passes
    venue.availablePasses -= numPasses;
    venue.inLine += numPasses;
    await venue.save();
    
    // 7. Send SMS with venue tagline
    await twilio.sendPassConfirmation(phone, venue, newPass);
    
    res.json({
      success: true,
      passId,
      clientSecret: paymentIntent.client_secret,
      qrCode: qrCodeData,
      pass: newPass
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET validate pass - REAL DATABASE
router.get('/passes/:passId/validate', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// POST use pass - REAL DATABASE
router.post('/passes/:passId/use', async (req, res) => {
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
    await pass.save();
    
    // Update venue stats
    await Venue.findByIdAndUpdate(pass.venueId, {
      $inc: { inLine: -pass.quantity }
    });
    
    res.json({ success: true, message: 'Pass used successfully' });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update venue pricing - REAL DATABASE
router.put('/venue/pricing', async (req, res) => {
  try {
    const { venueId, newPrice } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.currentPrice = newPrice;
    await venue.save();
    
    res.json({ success: true, newPrice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST activate passes - REAL DATABASE
router.post('/venue/activate', async (req, res) => {
  try {
    const { venueId, availablePasses } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = true;
    venue.availablePasses = availablePasses;
    await venue.save();
    
    res.json({ success: true, message: 'Passes activated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST deactivate passes - REAL DATABASE
router.post('/venue/deactivate', async (req, res) => {
  try {
    const { venueId } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = false;
    await venue.save();
    
    res.json({ success: true, message: 'Passes deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET venue stats - REAL DATABASE
router.get('/venue/:venueId/stats', async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Get today's transactions
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const transactions = await Transaction.find({
      venueId: req.params.venueId,
      createdAt: { $gte: startOfDay }
    });
    
    const revenue = transactions.reduce((sum, t) => sum + t.venueRevenue, 0);
    const passesSold = transactions.reduce((sum, t) => sum + (await Pass.findOne({ passId: t.passId }))?.quantity || 0, 0);
    
    res.json({
      revenue: Math.round(revenue),
      passesSold,
      currentWait: venue.waitTime,
      inLine: venue.inLine
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST push notification - REAL DATABASE
router.post('/notifications/push', async (req, res) => {
  try {
    const { venueId, message, radius } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // TODO: Find users within radius and send notifications
    
    res.json({ success: true, sent: 0, message: 'Feature coming soon' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET pricing suggestion
router.get('/pricing/ml-suggest', async (req, res) => {
  try {
    const { venueId } = req.query;
    
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
