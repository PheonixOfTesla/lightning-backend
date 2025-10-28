require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('./config/database');

const LightningController = require('./controllers/LightningController');
const ftController = require('./controllers/ftController');

const app = express();

// Connect to MongoDB
connectDB();

// CORS Configuration - Allow Vercel frontend
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'https://lightning-app-gold.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Routes
app.use('/api/v1/lightning', LightningController);
app.use('/api/v1/analytics', ftController);

// Root route
app.get('/', (req, res) => {
  res.json({ 
    status: 'alive',
    message: '⚡ Lightning Pass API',
    version: '1.0.0',
    timestamp: new Date(),
    endpoints: {
      health: '/health',
      venues: '/api/v1/lightning/venues',
      purchase: '/api/v1/lightning/passes/purchase',
      analytics: '/api/v1/analytics/system/overview'
    },
    frontend: 'https://lightning-app-gold.vercel.app'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date(),
    uptime: process.uptime(),
    mongodb: 'connected'
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET /health',
      'GET /api/v1/lightning/venues',
      'GET /api/v1/lightning/venues/:id',
      'POST /api/v1/lightning/passes/purchase',
      'GET /api/v1/lightning/venue/:venueId/stats',
      'PUT /api/v1/lightning/venue/pricing',
      'POST /api/v1/lightning/venue/activate',
      'POST /api/v1/lightning/venue/deactivate',
      'GET /api/v1/analytics/system/overview'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡ Lightning Pass API running on port ${PORT}`);
  console.log(`📍 Frontend: https://lightning-app-gold.vercel.app`);
  console.log(`🔗 Backend: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
});
