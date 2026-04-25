/**
 * Website Routes - Manage tracked websites
 */

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/websites - List all tracked websites with stats
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, sort = 'last_seen', order = 'DESC' } = req.query;

    let where = '';
    const params = [];

    if (search) {
      where = 'WHERE w.domain ILIKE $1';
      params.push(`%${search}%`);
    }

    const result = await query(
      `SELECT 
        w.id,
        w.domain,
        w.display_name,
        w.first_seen,
        w.last_seen,
        w.is_active,
        w.notes,
        w.request_count,
        COUNT(r.id) as actual_requests,
        COUNT(CASE WHEN r.method = 'GET' THEN 1 END) as get_count,
        COUNT(CASE WHEN r.method = 'POST' THEN 1 END) as post_count,
        COUNT(CASE WHEN r.method = 'PUT' THEN 1 END) as put_count,
        COUNT(CASE WHEN r.method = 'DELETE' THEN 1 END) as delete_count,
        COUNT(CASE WHEN r.status_code >= 200 AND r.status_code < 300 THEN 1 END) as success_count,
        COUNT(CASE WHEN r.status_code >= 400 THEN 1 END) as error_count,
        COUNT(DISTINCT r.redirect_chain_id) FILTER (WHERE r.redirect_chain_id IS NOT NULL) as redirect_count
       FROM websites w
       LEFT JOIN requests r ON r.website_id = w.id
       ${where}
       GROUP BY w.id
       ORDER BY w.last_seen DESC`,
      params
    );

    res.json({ websites: result.rows });
  } catch (err) {
    console.error('[Websites] List error:', err);
    res.status(500).json({ error: 'Failed to fetch websites' });
  }
});

/**
 * GET /api/websites/:id - Website detail with request breakdown
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const websiteResult = await query(
      'SELECT * FROM websites WHERE id = $1',
      [req.params.id]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    // Get method breakdown
    const methodBreakdown = await query(
      `SELECT method, COUNT(*) as count
       FROM requests WHERE website_id = $1
       GROUP BY method ORDER BY count DESC`,
      [req.params.id]
    );

    // Get status breakdown
    const statusBreakdown = await query(
      `SELECT 
        CASE
          WHEN status_code >= 200 AND status_code < 300 THEN '2xx'
          WHEN status_code >= 300 AND status_code < 400 THEN '3xx'
          WHEN status_code >= 400 AND status_code < 500 THEN '4xx'
          WHEN status_code >= 500 THEN '5xx'
          ELSE 'other'
        END as status_group,
        COUNT(*) as count
       FROM requests WHERE website_id = $1
       GROUP BY status_group ORDER BY count DESC`,
      [req.params.id]
    );

    // Get recent requests
    const recentRequests = await query(
      `SELECT id, url, method, status_code, request_type, duration_ms, captured_at
       FROM requests WHERE website_id = $1
       ORDER BY captured_at DESC LIMIT 10`,
      [req.params.id]
    );

    res.json({
      website: websiteResult.rows[0],
      methods: methodBreakdown.rows,
      statuses: statusBreakdown.rows,
      recentRequests: recentRequests.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch website details' });
  }
});

/**
 * PUT /api/websites/:id - Update website (notes, display name)
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { display_name, notes, is_active } = req.body;

    await query(
      `UPDATE websites SET
        display_name = COALESCE($1, display_name),
        notes = COALESCE($2, notes),
        is_active = COALESCE($3, is_active)
       WHERE id = $4`,
      [display_name, notes, is_active, req.params.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update website' });
  }
});

/**
 * DELETE /api/websites/:id - Delete website and all requests
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM websites WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete website' });
  }
});

module.exports = router;
