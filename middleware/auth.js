const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Verify JWT token middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(403).json({ error: 'No token provided' });
  }
  
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : authHeader;
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    req.venueId = decoded.venueId;  // For venue owners
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require specific role(s) middleware
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.userRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.userRole
      });
    }
    
    next();
  };
}

// Require venue ownership middleware (for venue-specific actions)
function requireVenueOwnership(req, res, next) {
  const venueId = req.params.venueId || req.body.venueId;
  
  if (!venueId) {
    return res.status(400).json({ error: 'Venue ID required' });
  }
  
  // Admin can access any venue
  if (req.userRole === 'admin') {
    return next();
  }
  
  // Venue owner can only access their own venue
  if (req.userRole === 'venue' && req.venueId) {
    if (req.venueId.toString() !== venueId.toString()) {
      return res.status(403).json({ error: 'Access denied to this venue' });
    }
    return next();
  }
  
  return res.status(403).json({ error: 'Venue ownership required' });
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      venueId: user.venueId  // For venue owners
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Login endpoint
async function login(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // Find user
    const User = require('../models/User');
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    console.log(`✅ User logged in: ${user.email} (${user.role})`);
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        venueId: user.venueId
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Register endpoint (for venue owners and admins)
async function register(req, res) {
  const { email, password, role, venueId } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  // Password strength check
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  try {
    const User = require('../models/User');
    
    // Check if user exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      email: email.toLowerCase(),
      phone: req.body.phone,
      passwordHash,
      role: role || 'customer',
      venueId: role === 'venue' ? venueId : undefined
    });
    
    await user.save();
    
    // Generate token
    const token = generateToken(user);
    
    console.log(`✅ User registered: ${user.email} (${user.role})`);
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        venueId: user.venueId
      }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

module.exports = {
  verifyToken,
  requireRole,
  requireVenueOwnership,
  generateToken,
  login,
  register
};
