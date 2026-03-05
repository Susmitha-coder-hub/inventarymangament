const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.API_PORT || 8080;

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Helper: Exponential backoff delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/reset
app.post('/api/products/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE products SET stock = 100, version = 1 WHERE id = 1');
    await client.query('UPDATE products SET stock = 50, version = 1 WHERE id = 2');
    await client.query('DELETE FROM orders');
    await client.query('COMMIT');
    res.json({ message: 'Product inventory reset successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/orders/pessimistic
app.post('/api/orders/pessimistic', async (req, res) => {
  const { productId, quantity, userId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Acquire row-level lock
    const productResult = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );

    if (productResult.rows.length === 0) {
      throw new Error('NOT_FOUND');
    }

    const product = productResult.rows[0];
    if (product.stock < quantity) {
      throw new Error('INSUFFICIENT_STOCK');
    }

    // Update stock
    await client.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2',
      [quantity, productId]
    );

    // Create order
    const orderResult = await client.query(
      'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [productId, quantity, userId, 'SUCCESS']
    );

    await client.query('COMMIT');
    res.status(201).json({
      orderId: orderResult.rows[0].id,
      productId,
      quantityOrdered: quantity,
      stockRemaining: product.stock - quantity
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Product not found' });
    } else if (err.message === 'INSUFFICIENT_STOCK') {
      await pool.query(
        'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
        [productId, quantity, userId, 'FAILED_OUT_OF_STOCK']
      );
      res.status(400).json({ error: 'Insufficient stock' });
    } else {
      res.status(500).json({ error: err.message });
    }
  } finally {
    client.release();
  }
});

// POST /api/orders/optimistic
app.post('/api/orders/optimistic', async (req, res) => {
  const { productId, quantity, userId } = req.body;
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Read current state
      const productResult = await client.query(
        'SELECT * FROM products WHERE id = $1',
        [productId]
      );

      if (productResult.rows.length === 0) {
        throw new Error('NOT_FOUND');
      }

      const product = productResult.rows[0];
      if (product.stock < quantity) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // Update with version check
      const updateResult = await client.query(
        'UPDATE products SET stock = stock - $1, version = version + 1 WHERE id = $2 AND version = $3 RETURNING stock, version',
        [quantity, productId, product.version]
      );

      if (updateResult.rowCount === 0) {
        throw new Error('CONFLICT');
      }

      // Create order
      const orderResult = await client.query(
        'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [productId, quantity, userId, 'SUCCESS']
      );

      await client.query('COMMIT');
      return res.status(201).json({
        orderId: orderResult.rows[0].id,
        productId,
        quantityOrdered: quantity,
        stockRemaining: updateResult.rows[0].stock,
        newVersion: updateResult.rows[0].version
      });

    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message === 'CONFLICT') {
        attempts++;
        if (attempts < maxRetries) {
          // Exponential backoff: 50ms, 100ms, 200ms...
          await delay(50 * Math.pow(2, attempts - 1));
          continue;
        }
        // Max retries reached
        await pool.query(
          'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
          [productId, quantity, userId, 'FAILED_CONFLICT']
        );
        return res.status(409).json({ error: 'Failed to place order due to concurrent modification. Please try again.' });
      } else if (err.message === 'INSUFFICIENT_STOCK') {
        await pool.query(
          'INSERT INTO orders (product_id, quantity_ordered, user_id, status) VALUES ($1, $2, $3, $4)',
          [productId, quantity, userId, 'FAILED_OUT_OF_STOCK']
        );
        return res.status(400).json({ error: 'Insufficient stock' });
      } else if (err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Product not found' });
      } else {
        return res.status(500).json({ error: err.message });
      }
    } finally {
      client.release();
    }
  }
});

// GET /api/orders/stats
app.get('/api/orders/stats', async (req, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_orders,
        COUNT(*) FILTER (WHERE status = 'FAILED_OUT_OF_STOCK') as failed_out_of_stock,
        COUNT(*) FILTER (WHERE status = 'FAILED_CONFLICT') as failed_conflict
      FROM orders
    `);

    const stats = statsResult.rows[0];
    res.json({
      totalOrders: parseInt(stats.total_orders),
      successfulOrders: parseInt(stats.successful_orders),
      failedOutOfStock: parseInt(stats.failed_out_of_stock),
      failedConflict: parseInt(stats.failed_conflict)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
