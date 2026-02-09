import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import {
  getSettings,
  getVehicleByPlate,
  insertAlert,
  insertHealth,
  insertHistory,
  upsertVehicle
} from './db.js';

const DEFAULT_URL = 'https://agendeam.com.br/ujf/motorista.php';

async function getSetting(key, fallback) {
  const settings = await getSettings();
  return settings?.[key] ?? fallback;
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
    const monitorUrl = await getSetting('monitor_url', DEFAULT_URL);
    const response = await fetch(monitorUrl, {
      headers: { 'User-Agent': 'monitor-2026/1.0' }
    });
    const html = await response.text();
    const rows = parseRows(html);
    const now = new Date().toISOString();

    const events = [];
    for (const row of rows) {
      const existing = await getVehicleByPlate(row.plate);
      const vehicleId = existing?.id ?? uuidv4();
      await upsertVehicle({
        id: vehicleId,
        plate: row.plate,
        carrier: row.carrier,
        status: row.status,
        last_seen_at: now
      });
      await insertHistory({
        id: uuidv4(),
        vehicle_id: vehicleId,
        status: row.status,
        observed_at: now
      });

      if (row.status.toUpperCase() === 'CHAMADO DA PORTARIA') {
        const alertId = uuidv4();
        await insertAlert({
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
    }

    healthRecord.status = 'success';
    healthRecord.cycle_finished_at = new Date().toISOString();
    healthRecord.response_time_ms = new Date(healthRecord.cycle_finished_at) - start;
    await insertHealth(healthRecord);

    if (events.length) {
      onEvents(events);
    }
  } catch (error) {
    healthRecord.status = 'failure';
    healthRecord.cycle_finished_at = new Date().toISOString();
    healthRecord.response_time_ms = new Date(healthRecord.cycle_finished_at) - start;
    healthRecord.error_message = error.message;
    await insertHealth(healthRecord);
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

  (async () => {
    const intervalMs = Number(await getSetting('monitor_interval_ms', '10000'));
    cycle();
    setInterval(cycle, intervalMs);
  })();
}
