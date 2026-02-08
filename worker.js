import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const DEFAULT_URL = 'https://agendeam.com.br/ujf/motorista.php';

const upsertVehicle = db.prepare(`
  INSERT INTO vehicles (id, plate, carrier, status, last_seen_at)
  VALUES (@id, @plate, @carrier, @status, @last_seen_at)
  ON CONFLICT(id) DO UPDATE SET
    status=excluded.status,
    carrier=excluded.carrier,
    last_seen_at=excluded.last_seen_at
`);

const insertHistory = db.prepare(
  'INSERT INTO status_history (id, vehicle_id, status, observed_at) VALUES (@id, @vehicle_id, @status, @observed_at)'
);

const insertAlert = db.prepare(
  'INSERT INTO alerts (id, vehicle_id, carrier, status, called_at) VALUES (@id, @vehicle_id, @carrier, @status, @called_at)'
);

const insertHealth = db.prepare(
  'INSERT INTO monitoring_health (cycle_started_at, cycle_finished_at, status, response_time_ms, error_message) VALUES (@cycle_started_at, @cycle_finished_at, @status, @response_time_ms, @error_message)'
);

const selectVehicle = db.prepare('SELECT * FROM vehicles WHERE plate = ?');
const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?');

function getSetting(key, fallback) {
  const row = selectSetting.get(key);
  return row ? row.value : fallback;
}

function normalizeCell(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td').map((__, cell) => normalizeCell($(cell).text())).get();
    if (cells.length < 3) return;
    rows.push({
      plate: cells[0],
      carrier: cells[1],
      status: cells[2]
    });
  });
  return rows;
}

export async function runMonitoringCycle({ onEvents }) {
  const start = new Date();
  const healthRecord = {
    cycle_started_at: start.toISOString(),
    cycle_finished_at: null,
    status: 'running',
    response_time_ms: null,
    error_message: null
  };

  try {
    const response = await fetch(getSetting('monitor_url', DEFAULT_URL), {
      headers: { 'User-Agent': 'monitor-2026/1.0' }
    });
    const html = await response.text();
    const rows = parseRows(html);
    const now = new Date().toISOString();

    const events = [];
    rows.forEach((row) => {
      const existing = selectVehicle.get(row.plate);
      const vehicleId = existing?.id ?? uuidv4();
      upsertVehicle.run({
        id: vehicleId,
        plate: row.plate,
        carrier: row.carrier,
        status: row.status,
        last_seen_at: now
      });
      insertHistory.run({
        id: uuidv4(),
        vehicle_id: vehicleId,
        status: row.status,
        observed_at: now
      });

      if (row.status.toUpperCase() === 'CHAMADO DA PORTARIA') {
        const alertId = uuidv4();
        insertAlert.run({
          id: alertId,
          vehicle_id: vehicleId,
          carrier: row.carrier,
          status: row.status,
          called_at: now
        });
        events.push({
          type: 'alert',
          id: alertId,
          plate: row.plate,
          carrier: row.carrier,
          status: row.status,
          called_at: now
        });
      }

      if (!existing || existing.status !== row.status) {
        events.push({
          type: 'status_change',
          plate: row.plate,
          carrier: row.carrier,
          status: row.status,
          previous_status: existing?.status ?? null,
          observed_at: now
        });
      }
    });

    healthRecord.status = 'success';
    healthRecord.cycle_finished_at = new Date().toISOString();
    healthRecord.response_time_ms = new Date(healthRecord.cycle_finished_at) - start;
    insertHealth.run(healthRecord);

    if (events.length) {
      onEvents(events);
    }
  } catch (error) {
    healthRecord.status = 'failure';
    healthRecord.cycle_finished_at = new Date().toISOString();
    healthRecord.response_time_ms = new Date(healthRecord.cycle_finished_at) - start;
    healthRecord.error_message = error.message;
    insertHealth.run(healthRecord);
    onEvents([{ type: 'monitoring_error', message: error.message }]);
  }
}

export function startQueue({ onEvents }) {
  let running = false;
  async function cycle() {
    if (running) return;
    running = true;
    await runMonitoringCycle({ onEvents });
    running = false;
  }

  const intervalMs = Number(getSetting('monitor_interval_ms', '10000'));
  cycle();
  return setInterval(cycle, intervalMs);
}
