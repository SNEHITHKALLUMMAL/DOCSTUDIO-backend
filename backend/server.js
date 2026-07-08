const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Render (and most PaaS hosts) sit behind a reverse proxy - trust it so
// express-rate-limit and req.ip work correctly.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS - allow the deployed frontend (and localhost during development).
// Accepts either FRONTEND_URL or CLIENT_URL (comma-separated list of origins),
// e.g. "https://your-app.vercel.app,http://localhost:3000"
// Both names are supported so a mismatch between what's documented and what's
// actually set on Render/wherever can't silently break every request.
const allowedOrigins = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, '')) // trim whitespace + any trailing slash
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server, health checks)
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : origin;
    if (!origin || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    console.warn(`CORS blocked request from origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
    const corsError = new Error('This origin is not allowed to access the API');
    corsError.statusCode = 403;
    return callback(corsError);
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/', limiter);

// Database connection
connectDB();

// Health check (also useful as Render's health check endpoint)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'DocForge API is running' });
});
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'DocForge API is running' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/conversion', require('./routes/conversion'));
app.use('/api/translation', require('./routes/translation'));

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Centralized error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
