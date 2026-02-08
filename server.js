import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import db from './db.js';
import { startQueue } from './worker.js';

const app = express();
const PORT = process.env.PORT || 3000;

const insertUser = db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (@id, @username, @password_hash, @created_at)');
const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const insertAudit = db.prepare('INSERT INTO audit_logs (id, username, action, created_at, metadata) VALUES (@id, @username, @action, @created_at, @metadata)');
const listVehicles = db.prepare('SELECT * FROM vehicles ORDER BY last_seen_at DESC');
const listAlerts = db.prepare('SELECT * FROM alerts ORDER BY called_at DESC');
const listHistory = db.prepare('SELECT * FROM status_history ORDER BY observed_at DESC LIMIT 200');
const countFila = db.prepare("SELECT COUNT(*) as total FROM vehicles WHERE status = 'FILA'");
const updateAlertConfirm = db.prepare('UPDATE alerts SET confirmed_by = ?, confirmed_at = ? WHERE id = ?');
const selectSettings = db.prepare('SELECT key, value FROM settings');
const upsertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const listHealth = db.prepare('SELECT * FROM monitoring_health ORDER BY id DESC LIMIT 20');

const sessionSecret = process.env.SESSION_SECRET || 'monitor-secret';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  message: 'Muitas tentativas, aguarde.'
}));

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  return next();
}

function ensureAdmin() {
  const existing = findUser.get('admin');
  if (!existing) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(password, 10);
    insertUser.run({
      id: uuidv4(),
      username: 'admin',
      password_hash: hash,
      created_at: new Date().toISOString()
    });
  }
}

function ensureSettings() {
  const defaults = {
    monitor_interval_ms: '10000',
    monitor_url: 'https://agendeam.com.br/ujf/motorista.php',
    target_carrier: 'TRANSPORTADORA SEIS',
    alert_volume: '1'
  };
  Object.entries(defaults).forEach(([key, value]) => {
    upsertSetting.run(key, value);
  });
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUser.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  req.session.user = { username: user.username };
  insertAudit.run({
    id: uuidv4(),
    username: user.username,
    action: 'login',
    created_at: new Date().toISOString(),
    metadata: null
  });
  return res.json({ ok: true, username: user.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  insertAudit.run({
    id: uuidv4(),
    username: req.session.user.username,
    action: 'logout',
    created_at: new Date().toISOString(),
    metadata: null
  });
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  return res.json({ username: req.session.user.username });
});

app.get('/api/vehicles', requireAuth, (req, res) => {
  res.json(listVehicles.all());
});

app.get('/api/history', requireAuth, (req, res) => {
  res.json(listHistory.all());
});

app.get('/api/alerts', requireAuth, (req, res) => {
  res.json(listAlerts.all());
});

app.post('/api/alerts/:id/confirm', requireAuth, (req, res) => {
  const now = new Date().toISOString();
  updateAlertConfirm.run(req.session.user.username, now, req.params.id);
  insertAudit.run({
    id: uuidv4(),
    username: req.session.user.username,
    action: 'confirm_alert',
    created_at: now,
    metadata: JSON.stringify({ alertId: req.params.id })
  });
  res.json({ ok: true, confirmed_at: now });
});

app.get('/api/counts', requireAuth, (req, res) => {
  res.json({ fila: countFila.get().total });
});

app.get('/api/settings', requireAuth, (req, res) => {
  const settings = {};
  selectSettings.all().forEach((row) => {
    settings[row.key] = row.value;
  });
  res.json(settings);
});

app.post('/api/settings', requireAuth, (req, res) => {
  Object.entries(req.body).forEach(([key, value]) => {
    upsertSetting.run(key, String(value));
  });
  insertAudit.run({
    id: uuidv4(),
    username: req.session.user.username,
    action: 'update_settings',
    created_at: new Date().toISOString(),
    metadata: JSON.stringify(req.body)
  });
  res.json({ ok: true });
});

app.get('/api/health', requireAuth, (req, res) => {
  res.json(listHealth.all());
});

app.get('/api/alerts/export', requireAuth, async (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  const alerts = listAlerts.all();

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Chamados');
    sheet.columns = [
      { header: 'Veículo', key: 'vehicle_id' },
      { header: 'Transportadora', key: 'carrier' },
      { header: 'Status', key: 'status' },
      { header: 'Chamado em', key: 'called_at' },
      { header: 'Confirmado por', key: 'confirmed_by' },
      { header: 'Confirmado em', key: 'confirmed_at' }
    ];
    alerts.forEach((alert) => sheet.addRow(alert));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="chamados.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="chamados.pdf"');
    doc.pipe(res);
    doc.fontSize(16).text('Relatório de Chamados', { align: 'center' });
    doc.moveDown();
    alerts.forEach((alert) => {
      doc.fontSize(10).text(`${alert.vehicle_id} | ${alert.carrier} | ${alert.status} | ${alert.called_at} | ${alert.confirmed_by ?? ''}`);
    });
    doc.end();
    return;
  }

  const csvHeader = 'Veiculo,Transportadora,Status,Chamado_em,Confirmado_por,Confirmado_em\n';
  const csvBody = alerts
    .map((alert) => [
      alert.vehicle_id,
      alert.carrier,
      alert.status,
      alert.called_at,
      alert.confirmed_by ?? '',
      alert.confirmed_at ?? ''
    ].join(','))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="chamados.csv"');
  res.send(csvHeader + csvBody);
});

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  req.app.locals.clients.add(send);
  req.on('close', () => {
    req.app.locals.clients.delete(send);
  });
});

app.use(express.static('public'));

ensureAdmin();
ensureSettings();

app.locals.clients = new Set();

startQueue({
  onEvents: (events) => {
    app.locals.clients.forEach((send) => {
      send(events);
    });
  }
});

app.listen(PORT, () => {
  console.log(`Monitor running on port ${PORT}`);
});
