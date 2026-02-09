import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const adapter = new JSONFile('monitor.json');

const defaultData = {
  users: [],
  vehicles: [],
  status_history: [],
  alerts: [],
  settings: {},
  monitoring_health: [],
  audit_logs: []
};

const db = new Low(adapter, defaultData);

function ensureData() {
  if (!db.data) {
    db.data = { ...defaultData };
  }
}

export async function initDb() {
  await db.read();
  ensureData();
  await db.write();
  return db;
}

export async function getUser(username) {
  await db.read();
  ensureData();
  return db.data.users.find((user) => user.username === username);
}

export async function createUser(user) {
  await db.read();
  ensureData();
  db.data.users.push(user);
  await db.write();
}

export async function upsertVehicle(vehicle) {
  await db.read();
  ensureData();
  const index = db.data.vehicles.findIndex((item) => item.id === vehicle.id);
  if (index >= 0) {
    db.data.vehicles[index] = { ...db.data.vehicles[index], ...vehicle };
  } else {
    db.data.vehicles.push(vehicle);
  }
  await db.write();
}

export async function listVehicles() {
  await db.read();
  ensureData();
  return [...db.data.vehicles].sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
}

export async function getVehicleByPlate(plate) {
  await db.read();
  ensureData();
  return db.data.vehicles.find((vehicle) => vehicle.plate === plate);
}

export async function insertHistory(entry) {
  await db.read();
  ensureData();
  db.data.status_history.push(entry);
  await db.write();
}

export async function listHistory(limit = 200) {
  await db.read();
  ensureData();
  return [...db.data.status_history]
    .sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at))
    .slice(0, limit);
}

export async function insertAlert(alert) {
  await db.read();
  ensureData();
  db.data.alerts.push(alert);
  await db.write();
}

export async function listAlerts() {
  await db.read();
  ensureData();
  return [...db.data.alerts].sort((a, b) => new Date(b.called_at) - new Date(a.called_at));
}

export async function confirmAlert(id, username, confirmedAt) {
  await db.read();
  ensureData();
  const alert = db.data.alerts.find((item) => item.id === id);
  if (alert) {
    alert.confirmed_by = username;
    alert.confirmed_at = confirmedAt;
    await db.write();
  }
  return alert;
}

export async function countFila() {
  await db.read();
  ensureData();
  return db.data.vehicles.filter((vehicle) => vehicle.status === 'FILA').length;
}

export async function getSettings() {
  await db.read();
  ensureData();
  return db.data.settings;
}

export async function setSettings(settings) {
  await db.read();
  ensureData();
  db.data.settings = { ...db.data.settings, ...settings };
  await db.write();
}

export async function insertHealth(entry) {
  await db.read();
  ensureData();
  db.data.monitoring_health.push(entry);
  await db.write();
}

export async function listHealth(limit = 20) {
  await db.read();
  ensureData();
  return [...db.data.monitoring_health]
    .sort((a, b) => new Date(b.cycle_started_at) - new Date(a.cycle_started_at))
    .slice(0, limit);
}

export async function insertAudit(entry) {
  await db.read();
  ensureData();
  db.data.audit_logs.push(entry);
  await db.write();
}

export async function ensureSettings(defaults) {
  await db.read();
  ensureData();
  db.data.settings = { ...defaults, ...db.data.settings };
  await db.write();
}

export default db;
