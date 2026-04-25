/**
 * Request Routes - CRUD for captured HTTP requests
 */

const express = require('express');
const { query, getClient } = require('../db');
const { authMiddleware, apiKeyMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/requests - Receive requests from extension (batch)
 * Uses API key auth (not JWT)
 */
router.post('/', apiKeyMiddleware, async (req, res) => {
  const client = await getClient();

  try {
    const requests = Array.isArray(req.body) ? req.body : [req.body];

    await client.query('BEGIN');

    let inserted = 0;

    for (const r of requests) {
      if (!r.url) continue;

      // Extract domain
      let domain;
      try {
        domain = new URL(r.url).hostname;
      } catch {
        domain = 'unknown';
      }

      // Upsert website
      const websiteResult = await client.query(
        `INSERT INTO websites (domain, display_name, last_seen, request_count)
         VALUES ($1, $1, NOW(), 1)
         ON CONFLICT (domain) DO UPDATE SET
           last_seen = NOW(),
           request_count = websites.request_count + 1
         RETURNING id`,
        [domain]
      );

      const websiteId = websiteResult.rows[0].id;

      // Insert request
      await client.query(
        `INSERT INTO requests (
          ext_request_id, website_id, tab_id, url, method, status_code, status_line,
          request_type, initiator, request_headers, response_headers,
          request_body, response_body, duration_ms, from_cache, response_size,
          redirect_chain_id, redirect_from, redirect_to, source, phase, error,
          request_time
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22,
          $23
        )`,
        [
          r.id || null,
          websiteId,
          r.tabId || null,
          r.url,
          r.method || 'GET',
          r.statusCode || null,
          r.statusLine || null,
          r.type || r.requestType || null,
          r.initiator || null,
          JSON.stringify(r.requestHeaders || {}),
          JSON.stringify(r.responseHeaders || {}),
          r.requestBody ? (typeof r.requestBody === 'string' ? r.requestBody : JSON.stringify(r.requestBody)) : null,
          r.responseBody || null,
          r.duration || r.totalTime || null,
          r.fromCache || false,
          r.responseSize || null,
          r.redirectChainId || null,
          r.jsRedirectFrom || r.metaRedirectFrom || null,
          r.redirectTo || null,
          r.source || 'extension',
          r.phase || null,
          r.error || null,
          r.timestamp ? new Date(r.timestamp) : null,
        ]
      );

      inserted++;
    }

    await client.query('COMMIT');
    res.json({ ok: true, inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Requests] Insert error:', err);
    res.status(500).json({ error: 'Failed to save requests' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/requests - List requests with pagination & filtering
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      website_id,
      method,
      status,
      type,
      search,
      sort = 'captured_at',
      order = 'DESC',
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramCount = 0;

    if (website_id) {
      conditions.push(`r.website_id = $${++paramCount}`);
      params.push(parseInt(website_id));
    }

    if (method) {
      conditions.push(`r.method = $${++paramCount}`);
      params.push(method.toUpperCase());
    }

    if (status) {
      if (status.endsWith('xx')) {
        const prefix = status.charAt(0);
        conditions.push(`r.status_code >= $${++paramCount} AND r.status_code < $${++paramCount}`);
        params.push(parseInt(prefix) * 100);
        params.push((parseInt(prefix) + 1) * 100);
      } else {
        conditions.push(`r.status_code = $${++paramCount}`);
        params.push(parseInt(status));
      }
    }

    if (type) {
      conditions.push(`r.request_type = $${++paramCount}`);
      params.push(type);
    }

    if (search) {
      conditions.push(`r.url ILIKE $${++paramCount}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowed sort fields
    const allowedSorts = ['captured_at', 'method', 'status_code', 'url', 'duration_ms'];
    const sortField = allowedSorts.includes(sort) ? sort : 'captured_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count
    const countResult = await query(
      `SELECT COUNT(*) FROM requests r ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch
    const result = await query(
      `SELECT r.*, w.domain
       FROM requests r
       LEFT JOIN websites w ON w.id = r.website_id
       ${where}
       ORDER BY r.${sortField} ${sortOrder}
       LIMIT $${++paramCount} OFFSET $${++paramCount}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      requests: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[Requests] List error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * GET /api/requests/:id - Single request detail
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*, w.domain
       FROM requests r
       LEFT JOIN websites w ON w.id = r.website_id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({ request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

/**
 * DELETE /api/requests/:id - Delete a request
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM requests WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

/**
 * DELETE /api/requests - Delete all requests (with optional website_id filter)
 */
router.delete('/', authMiddleware, async (req, res) => {
  try {
    if (req.query.website_id) {
      await query('DELETE FROM requests WHERE website_id = $1', [req.query.website_id]);
    } else {
      await query('DELETE FROM requests');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete requests' });
  }
});

module.exports = router;
