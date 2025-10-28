const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
  passId: { type: String, required: true, unique: true },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
  venueName: { type: String, required: true },
  userId: mongoose.Schema.Types.ObjectId,
  email: { type: String, required: true },
  phone: { type: String, required: true },
  purchasePrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['active', 'used', 'expired'], default: 'active' },
  qrCode: { type: String, required: true },
  validUntil: { type: Date, required: true },
  usedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Pass', passSchema);
