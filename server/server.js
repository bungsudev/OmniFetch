/**
 * OmniFetch by BungsuDev - Backend Server
 * Express API + Admin Panel + PostgreSQL
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { pool, query } = require('./db');

const app = express();
const PORT = process.env.PORT || 3847;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors({
  origin: '*', // Allow extension access
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.url}`);
  next();
});

// Static files (Admin Panel)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api/auth', require('./routes/auth'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/websites', require('./routes/websites'));
app.use('/api/redirects', require('./routes/redirects'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Dashboard stats
const { authMiddleware } = require('./middleware/auth');
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const [websites, requests, redirects, recentActivity] = await Promise.all([
      query('SELECT COUNT(*) as count FROM websites'),
      query('SELECT COUNT(*) as count FROM requests'),
      query('SELECT COUNT(*) as count FROM redirect_chains'),
      query(`SELECT 
        DATE(captured_at) as date,
        COUNT(*) as count
        FROM requests
        WHERE captured_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(captured_at)
        ORDER BY date DESC`),
    ]);

    res.json({
      totalWebsites: parseInt(websites.rows[0].count),
      totalRequests: parseInt(requests.rows[0].count),
      totalRedirects: parseInt(redirects.rows[0].count),
      recentActivity: recentActivity.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// SPA fallback - serve dashboard for any non-API route
app.get('*', (req, res) => {
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

async function initDatabase() {
  try {
    // Create database if not exists
    const client = await pool.connect();

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      await client.query(schema);
      console.log('[DB] Schema applied successfully');
    }

    // Check if admin user exists
    const adminCheck = await client.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(adminCheck.rows[0].count) === 0) {
      // Create default admin
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 12);
      await client.query(
        'INSERT INTO admin_users (email, password_hash, name) VALUES ($1, $2, $3)',
        [
          process.env.ADMIN_EMAIL || 'admin@tracker.local',
          hash,
          process.env.ADMIN_NAME || 'Administrator',
        ]
      );
      console.log(`[DB] Default admin created: ${process.env.ADMIN_EMAIL || 'admin@tracker.local'}`);
    }

    client.release();
    console.log('[DB] Database initialized');
  } catch (err) {
    console.error('[DB] Initialization error:', err.message);

    // If database doesn't exist, try to create it
    if (err.message.includes('does not exist')) {
      console.log('[DB] Attempting to create database...');
      try {
        const { Pool: TempPool } = require('pg');
        const tempPool = new TempPool({
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          user: process.env.DB_USER || 'mac',
          database: 'postgres',
        });

        await tempPool.query(`CREATE DATABASE ${process.env.DB_NAME || 'http_tracker'}`);
        console.log('[DB] Database created! Retrying initialization...');
        await tempPool.end();

        // Retry
        return initDatabase();
      } catch (createErr) {
        console.error('[DB] Failed to create database:', createErr.message);
        process.exit(1);
      }
    }
  }
}

// ============================================================================
// START SERVER
// ============================================================================

async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log('');
    console.log('  ⚡ OmniFetch by BungsuDev — Server');
    console.log('  ════════════════════════════════════');
    console.log(`  🌐 Admin Panel:  http://localhost:${PORT}`);
    console.log(`  📡 API Base:     http://localhost:${PORT}/api`);
    console.log(`  🔑 Admin Login:  ${process.env.ADMIN_EMAIL || 'admin@tracker.local'}`);
    console.log(`  📝 API Key:      ${process.env.API_KEY}`);
    console.log('  ════════════════════════════════════');
    console.log('');
  });
}

start();
