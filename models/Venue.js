const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: 'Nightclub' },
  address: { type: String, required: true },
  coordinates: {
    lat: { type: Number, default: 27.3364 },
    lng: { type: Number, default: -82.5307 }
  },
  capacity: { type: Number, default: 500 },
  currentPrice: { type: Number, default: 35 },
  basePrice: { type: Number, default: 25 },
  availablePasses: { type: Number, default: 50 },
  isActive: { type: Boolean, default: true },
  waitTime: { type: Number, default: 45 },
  inLine: { type: Number, default: 0 },
  tonightTagline: { type: String, default: '' },
  status: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  trending: { type: Boolean, default: false },
  ownerId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Venue', venueSchema);
