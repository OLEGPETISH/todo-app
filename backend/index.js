require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      done BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

// WebSocket подключение
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ===== ROUTES =====

app.get('/tasks', async (req, res) => {
  const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
  res.json(result.rows);
});

app.get('/tasks/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

app.post('/tasks', async (req, res) => {
  const { title, description } = req.body;
  const result = await pool.query(
    'INSERT INTO tasks (title, description) VALUES ($1, $2) RETURNING *',
    [title, description]
  );
  io.emit('taskCreated', result.rows[0]); // уведомить всех
  res.status(201).json(result.rows[0]);
});

app.put('/tasks/:id', async (req, res) => {
  const { title, description, done } = req.body;
  const result = await pool.query(
    'UPDATE tasks SET title=$1, description=$2, done=$3 WHERE id=$4 RETURNING *',
    [title, description, done, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  io.emit('taskUpdated', result.rows[0]); // уведомить всех
  res.json(result.rows[0]);
});

app.delete('/tasks/:id', async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  io.emit('taskDeleted', { id: req.params.id }); // уведомить всех
  res.json({ message: 'Deleted' });
});

const emailRoutes = require('./emailRoutes');
app.use('/email', emailRoutes);

initDB().then(() => {
  server.listen(3000, () => console.log('Server running on port 3000'));
});