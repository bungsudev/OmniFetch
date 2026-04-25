/**
 * Redirect Routes - Manage redirect chains
 */

const express = require('express');
const { query, getClient } = require('../db');
const { authMiddleware, apiKeyMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/redirects - Receive redirect chains from extension
 */
router.post('/', apiKeyMiddleware, async (req, res) => {
  const client = await getClient();

  try {
    const chains = Array.isArray(req.body) ? req.body : [req.body];

    await client.query('BEGIN');

    let insertedChains = 0;

    for (const chain of chains) {
      if (!chain.steps || chain.steps.length === 0) continue;

      // Extract domain from first step
      let domain;
      try {
        domain = new URL(chain.steps[0].from || chain.steps[0].to).hostname;
      } catch {
        domain = 'unknown';
      }

      // Upsert website
      const websiteResult = await client.query(
        `INSERT INTO websites (domain, display_name, last_seen)
         VALUES ($1, $1, NOW())
         ON CONFLICT (domain) DO UPDATE SET last_seen = NOW()
         RETURNING id`,
        [domain]
      );

      const websiteId = websiteResult.rows[0].id;

      // Get final URL
      const lastStep = chain.steps[chain.steps.length - 1];
      const finalUrl = lastStep.to || lastStep.from;

      // Insert chain
      const chainResult = await client.query(
        `INSERT INTO redirect_chains (chain_ext_id, website_id, tab_id, step_count, final_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [chain.id, websiteId, chain.tabId || null, chain.steps.length, finalUrl]
      );

      const chainId = chainResult.rows[0].id;

      // Insert steps
      for (let i = 0; i < chain.steps.length; i++) {
        const step = chain.steps[i];
        await client.query(
          `INSERT INTO redirect_steps (chain_id, step_order, redirect_type, status_code, method, from_url, to_url, delay_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            chainId,
            i + 1,
            step.type || 'http',
            step.statusCode || null,
            step.method || null,
            step.from || null,
            step.to || null,
            step.delay || null,
          ]
        );
      }

      insertedChains++;
    }

    await client.query('COMMIT');
    res.json({ ok: true, insertedChains });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Redirects] Insert error:', err);
    res.status(500).json({ error: 'Failed to save redirect chains' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/redirects - List redirect chains
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { website_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '';
    const params = [];
    let paramCount = 0;

    if (website_id) {
      where = `WHERE rc.website_id = $${++paramCount}`;
      params.push(parseInt(website_id));
    }

    const chainsResult = await query(
      `SELECT rc.*, w.domain
       FROM redirect_chains rc
       LEFT JOIN websites w ON w.id = rc.website_id
       ${where}
       ORDER BY rc.captured_at DESC
       LIMIT $${++paramCount} OFFSET $${++paramCount}`,
      [...params, parseInt(limit), offset]
    );

    // Get steps for each chain
    const chains = [];
    for (const chain of chainsResult.rows) {
      const stepsResult = await query(
        `SELECT * FROM redirect_steps WHERE chain_id = $1 ORDER BY step_order`,
        [chain.id]
      );
      chains.push({
        ...chain,
        steps: stepsResult.rows,
      });
    }

    res.json({ chains });
  } catch (err) {
    console.error('[Redirects] List error:', err);
    res.status(500).json({ error: 'Failed to fetch redirect chains' });
  }
});

/**
 * DELETE /api/redirects/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM redirect_chains WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete redirect chain' });
  }
});

module.exports = router;
