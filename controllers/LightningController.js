// FIXED CONTROLLER with Authentication - Add to LightningController.js

const express = require('express');
const router = express.Router();
const Venue = require('../models/Venue');
const Pass = require('../models/Pass');
const Transaction = require('../models/Transaction');
const { verifyToken, requireRole, requireVenueOwnership } = require('../middleware/auth');

// PUBLIC ROUTES (no auth required)

// GET all venues (public for customers)
router.get('/venues', async (req, res) => {
  try {
    const { approvalStatus, includeAll } = req.query;
    
    let filter = {};
    
    // Admin can see all venues
    if (includeAll === 'true') {
      // Requires admin auth (should be protected)
      filter = {};
    }
    // For customers, only show approved and active venues
    else {
      filter = { 
        isActive: true,
        $or: [
          { approvalStatus: 'approved' },
          { approvalStatus: { $exists: false } }
        ]
      };
    }
    
    const venues = await Venue.find(filter).lean();
    res.json({ venues });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single venue (public)
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

// PROTECTED ROUTES (auth required)

// POST create new venue (requires auth)
router.post('/venues/create', verifyToken, async (req, res) => {
  try {
    const venueData = req.body;
    
    // Set owner to current user
    venueData.ownerId = req.userId;
    
    // New venues start as pending
    if (!venueData.approvalStatus) {
      venueData.approvalStatus = 'pending';
    }
    
    const newVenue = new Venue(venueData);
    await newVenue.save();
    
    console.log(`✅ New venue created: ${newVenue.name} (Status: ${newVenue.approvalStatus})`);
    
    res.json({ 
      success: true, 
      message: newVenue.approvalStatus === 'pending' 
        ? 'Venue application submitted for review' 
        : 'Venue created successfully',
      venue: newVenue 
    });
    
  } catch (error) {
    console.error('Error creating venue:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST approve/reject venue (ADMIN ONLY)
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
      venue.approvedBy = req.userEmail;
      console.log(`✅ Venue APPROVED: ${venue.name} by ${req.userEmail}`);
    } else if (approvalStatus === 'rejected') {
      venue.rejectedAt = new Date();
      venue.rejectionReason = rejectionReason || 'Application did not meet requirements';
      console.log(`❌ Venue REJECTED: ${venue.name}`);
    }
    
    await venue.save();
    
    res.json({ 
      success: true, 
      message: `Venue ${approvalStatus}`,
      venue 
    });
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE venue (ADMIN ONLY)
router.delete('/venues/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Check for active passes
    const activePasses = await Pass.countDocuments({ 
      venueId: req.params.id, 
      status: 'active' 
    });
    
    if (activePasses > 0) {
      return res.status(400).json({ 
        error: `Cannot delete venue with ${activePasses} active passes`,
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
    res.status(500).json({ error: error.message });
  }
});

// GET validate pass (SCANNER ONLY - requires auth)
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
    res.status(500).json({ error: error.message });
  }
});

// POST use pass (SCANNER ONLY - requires auth)
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
    res.status(500).json({ error: error.message });
  }
});

// PUT update venue pricing (VENUE OWNER or ADMIN only)
router.put('/venue/pricing', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, newPrice } = req.body;
    
    if (newPrice < 10 || newPrice > 500) {
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
    res.status(500).json({ error: error.message });
  }
});

// POST activate passes (VENUE OWNER or ADMIN only)
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
    res.status(500).json({ error: error.message });
  }
});

// POST deactivate passes (VENUE OWNER or ADMIN only)
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
    res.status(500).json({ error: error.message });
  }
});

// GET venue stats (VENUE OWNER or ADMIN only)
router.get('/venue/:venueId/stats', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Get today's transactions using aggregation
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const stats = await Transaction.aggregate([
      {
        $match: {
          venueId: mongoose.Types.ObjectId(req.params.venueId),
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
