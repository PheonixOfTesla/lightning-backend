const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  passwordHash: String,
  role: { type: String, enum: ['customer', 'venue', 'admin'], default: 'customer' },
  venueId: mongoose.Schema.Types.ObjectId,
  totalSpent: { type: Number, default: 0 },
  passesUsed: { type: Number, default: 0 },
  favoriteVenues: [mongoose.Schema.Types.ObjectId],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
