const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
  passId: { type: String, required: true, unique: true, index: true },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
  venueName: { type: String, required: true },
  userId: mongoose.Schema.Types.ObjectId,
  email: { type: String, required: true, index: true },
  phone: { type: String, required: true },
  purchasePrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  amount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['active', 'used', 'expired', 'cancelled'], 
    default: 'active',
    index: true 
  },
  qrCode: { type: String, required: true },
  validUntil: { type: Date, required: true, index: true },
  usedAt: Date,
  usedBy: String,  // Email of scanner who marked it used
  
  // Payment tracking for idempotency
  stripePaymentIntentId: { type: String, unique: true, sparse: true, index: true },
  
  // Metadata
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
passSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Compound indexes for common queries
passSchema.index({ venueId: 1, status: 1, createdAt: -1 });
passSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('Pass', passSchema);
