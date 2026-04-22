const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const Imap = require('node-imap');

// === SMTP: Отправить письмо ===
router.post('/send', async (req, res) => {
  const { to, subject, text } = req.body;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  try {
    await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
    res.json({ success: true, message: 'Email sent via SMTP' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === IMAP: Получить последние письма ===
router.get('/imap', (req, res) => {
  const imap = new Imap({
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASS,
    host: process.env.IMAP_HOST,
    port: process.env.IMAP_PORT,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });
  const emails = [];
  imap.once('ready', () => {
    imap.openBox('INBOX', true, (err, box) => {
      if (err) return res.status(500).json({ error: err.message });
      const total = box.messages.total;
      if (total === 0) { imap.end(); return res.json([]); }
      const start = Math.max(1, total - 4);
      const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)' });
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          let buffer = '';
          stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
          stream.once('end', () => emails.push(buffer));
        });
      });
      fetch.once('end', () => { imap.end(); res.json(emails); });
    });
  });
  imap.once('error', (err) => res.status(500).json({ error: err.message }));
  imap.connect();
});

// === POP3: Проверить количество писем ===
router.get('/pop3', (req, res) => {
  const net = require('tls');
  const socket = net.connect({
    host: process.env.POP3_HOST,
    port: parseInt(process.env.POP3_PORT),
    rejectUnauthorized: false,
  });

  let step = 0;
  let response = '';
  let messageCount = null;

  socket.on('data', (data) => {
    const line = data.toString();
    response += line;

    if (step === 0 && line.startsWith('+OK')) {
      step = 1;
      socket.write(`USER ${process.env.SMTP_USER}\r\n`);
    } else if (step === 1 && line.startsWith('+OK')) {
      step = 2;
      socket.write(`PASS ${process.env.SMTP_PASS}\r\n`);
    } else if (step === 2 && line.startsWith('+OK')) {
      step = 3;
      socket.write('STAT\r\n');
    } else if (step === 3 && line.startsWith('+OK')) {
      const parts = line.trim().split(' ');
      messageCount = parseInt(parts[1]);
      socket.write('QUIT\r\n');
      socket.end();
      res.json({ protocol: 'POP3', totalMessages: messageCount, raw: line.trim() });
    } else if (line.startsWith('-ERR')) {
      socket.end();
      res.status(500).json({ error: line.trim() });
    }
  });

  socket.on('error', (err) => res.status(500).json({ error: err.message }));
});

module.exports = router;