require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('./config/database');
const { login, register } = require('./middleware/auth');

const LightningController = require('./controllers/LightningController');
const ftController = require('./controllers/ftController');

const app = express();

// Connect to MongoDB
connectDB();

// ========================================
// CORS Configuration - FIXED
// ========================================
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'https://lightning-app-gold.vercel.app',
  'https://lightning-app-peach.vercel.app',  // ✅ FIXED: Added your actual frontend URL
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️  Blocked CORS request from:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// ========================================
// Body Parsing Middleware
// ========================================

// Stripe webhook needs raw body (BEFORE express.json())
app.use('/api/v1/lightning/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// Rate Limiting
// ========================================

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/v1/auth/', authLimiter);

// ========================================
// Request Logging (Development)
// ========================================

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
      origin: req.headers.origin,
      auth: req.headers.authorization ? 'Present' : 'None'
    });
    next();
  });
}

// ========================================
// Auth Routes
// ========================================

app.post('/api/v1/auth/login', login);
app.post('/api/v1/auth/register', register);

// ========================================
// Main API Routes
// ========================================

app.use('/api/v1/lightning', LightningController);
app.use('/api/v1/analytics', ftController);

// ========================================
// Root & Health Routes
// ========================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'alive',
    message: '⚡ Lightning Pass API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    endpoints: {
      health: '/health',
      auth: {
        login: 'POST /api/v1/auth/login',
        register: 'POST /api/v1/auth/register'
      },
      public: {
        venues: 'GET /api/v1/lightning/venues',
        venue: 'GET /api/v1/lightning/venues/:id',
        mlPricing: 'GET /api/v1/lightning/pricing/ml-suggest'
      },
      protected: {
        createVenue: 'POST /api/v1/lightning/venues/create [AUTH]',
        purchase: 'POST /api/v1/lightning/passes/create-payment',
        confirm: 'POST /api/v1/lightning/passes/confirm-payment',
        validatePass: 'GET /api/v1/lightning/passes/:id/validate [AUTH]',
        usePass: 'POST /api/v1/lightning/passes/:id/use [AUTH]',
        venueStats: 'GET /api/v1/lightning/venue/:id/stats [AUTH]',
        pricing: 'PUT /api/v1/lightning/venue/pricing [AUTH]',
        activate: 'POST /api/v1/lightning/venue/activate [AUTH]',
        deactivate: 'POST /api/v1/lightning/venue/deactivate [AUTH]',
        analytics: 'GET /api/v1/analytics/system/overview'
      }
    },
    frontend: 'https://lightning-app-peach.vercel.app',
    allowedOrigins: allowedOrigins
  });
});

app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'production',
    nodeVersion: process.version
  });
});

// Test CORS endpoint
app.get('/api/v1/test/cors', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// ========================================
// Error Handlers
// ========================================

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
    suggestion: 'Check the API documentation at GET /'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  
  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS Error',
      message: 'Origin not allowed',
      origin: req.headers.origin,
      allowedOrigins: allowedOrigins
    });
  }
  
  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message
    });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Invalid token'
    });
  }
  
  // Default error
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err 
    })
  });
});

// ========================================
// Start Server
// ========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('');
  console.log('⚡'.repeat(40));
  console.log('⚡ Lightning Pass API Started Successfully!');
  console.log('⚡'.repeat(40));
  console.log('');
  console.log(`🚀 Server:      http://localhost:${PORT}`);
  console.log(`🏥 Health:      http://localhost:${PORT}/health`);
  console.log(`📱 Frontend:    https://lightning-app-peach.vercel.app`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('');
  console.log('🔐 Auth Endpoints:');
  console.log(`   POST /api/v1/auth/login`);
  console.log(`   POST /api/v1/auth/register`);
  console.log('');
  console.log('📋 Public Endpoints:');
  console.log(`   GET  /api/v1/lightning/venues`);
  console.log(`   GET  /api/v1/lightning/venues/:id`);
  console.log('');
  console.log('✅ CORS Configured for:');
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
  console.log('');
  console.log('⚡'.repeat(40));
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
