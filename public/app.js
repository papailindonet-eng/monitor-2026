const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const filaCount = document.getElementById('fila-count');
const vehiclesTable = document.getElementById('vehicles-table');
const alertsTable = document.getElementById('alerts-table');
const alertSearch = document.getElementById('alert-search');
const alertStart = document.getElementById('alert-start');
const alertEnd = document.getElementById('alert-end');
const alertCarrier = document.getElementById('alert-carrier');
const alertStatus = document.getElementById('alert-status');
const alertSort = document.getElementById('alert-sort');
const historyList = document.getElementById('history-list');
const realtimeEvents = document.getElementById('realtime-events');
const healthList = document.getElementById('health-list');
const metrics = document.getElementById('metrics');
const reportCarrier = document.getElementById('report-carrier');
const reportHour = document.getElementById('report-hour');
const lastCycle = document.getElementById('last-cycle');
const failureCount = document.getElementById('failure-count');
const healthStatus = document.getElementById('health-status');
const settingsForm = document.getElementById('settings-form');
const settingsStatus = document.getElementById('settings-status');
const alertModal = document.getElementById('alert-modal');
const alertMessage = document.getElementById('alert-message');
const confirmAlertButton = document.getElementById('confirm-alert');

let pendingAlertId = null;
let audioContext;
let oscillator;
let alertsCache = [];

function showApp() {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
}

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error('Erro na requisição');
  }
  return response.json();
}

async function loadDashboard() {
  const [vehicles, alerts, history, counts, health] = await Promise.all([
    fetchJSON('/api/vehicles'),
    fetchJSON('/api/alerts'),
    fetchJSON('/api/history'),
    fetchJSON('/api/counts'),
    fetchJSON('/api/health')
  ]);

  filaCount.textContent = counts.fila;

  alertsCache = alerts;
  vehiclesTable.innerHTML = vehicles
    .map((vehicle) => `
      <tr>
        <td>${vehicle.plate}</td>
        <td>${vehicle.carrier}</td>
        <td>${vehicle.status}</td>
        <td>${new Date(vehicle.last_seen_at).toLocaleString()}</td>
      </tr>
    `)
    .join('');

  renderAlertsTable();

  historyList.innerHTML = history
    .map((item) => `<li>${item.vehicle_id} • ${item.status} • ${new Date(item.observed_at).toLocaleString()}</li>`)
    .join('');

  const failures = health.filter((item) => item.status === 'failure');
  failureCount.textContent = failures.length;
  if (health.length) {
    lastCycle.textContent = new Date(health[0].cycle_finished_at ?? health[0].cycle_started_at).toLocaleTimeString();
  }

  healthList.innerHTML = health
    .map((item) => `<li>${item.status.toUpperCase()} • ${item.cycle_started_at} • ${item.error_message ?? 'OK'}</li>`)
    .join('');

  updateReports(alerts);
}

function renderAlertsTable() {
  const search = alertSearch.value.trim().toLowerCase();
  const carrierFilter = alertCarrier.value.trim().toLowerCase();
  const statusFilter = alertStatus.value.trim().toLowerCase();
  const startDate = alertStart.value ? new Date(alertStart.value) : null;
  const endDate = alertEnd.value ? new Date(alertEnd.value) : null;
  const sorted = [...alertsCache].sort((a, b) => {
    const timeA = new Date(a.called_at).getTime();
    const timeB = new Date(b.called_at).getTime();
    return alertSort.value === 'asc' ? timeA - timeB : timeB - timeA;
  });

  const filtered = sorted.filter((alert) => {
    const value = `${alert.vehicle_id} ${alert.carrier} ${alert.status}`.toLowerCase();
    const calledAt = new Date(alert.called_at);
    if (search && !value.includes(search)) return false;
    if (carrierFilter && !alert.carrier.toLowerCase().includes(carrierFilter)) return false;
    if (statusFilter && !alert.status.toLowerCase().includes(statusFilter)) return false;
    if (startDate && calledAt < startDate) return false;
    if (endDate && calledAt > new Date(endDate.getTime() + 86399999)) return false;
    return true;
  });

  alertsTable.innerHTML = filtered
    .map((alert) => `
      <tr>
        <td>${alert.vehicle_id}</td>
        <td>${alert.carrier}</td>
        <td>${alert.status}</td>
        <td>${new Date(alert.called_at).toLocaleString()}</td>
        <td>${alert.confirmed_by ?? '-'}</td>
        <td>${alert.confirmed_at ? new Date(alert.confirmed_at).toLocaleString() : '-'}</td>
      </tr>
    `)
    .join('') || '<tr><td colspan="6">Nenhum chamado encontrado.</td></tr>';
}

function updateReports(alerts) {
  const byCarrier = alerts.reduce((acc, alert) => {
    acc[alert.carrier] = (acc[alert.carrier] || 0) + 1;
    return acc;
  }, {});
  reportCarrier.innerHTML = Object.entries(byCarrier)
    .map(([carrier, total]) => `<div class="metric"><span>${carrier}</span><strong>${total}</strong></div>`)
    .join('') || '<div class="metric">Sem dados</div>';

  const byHour = alerts.reduce((acc, alert) => {
    const hour = new Date(alert.called_at).getHours();
    acc[hour] = (acc[hour] || 0) + 1;
    return acc;
  }, {});
  reportHour.innerHTML = Object.entries(byHour)
    .map(([hour, total]) => `<div class="metric"><span>${hour}:00</span><strong>${total}</strong></div>`)
    .join('') || '<div class="metric">Sem dados</div>';
}

function updateMetrics(events) {
  metrics.innerHTML = events
    .slice(0, 5)
    .map((event) => `<div class="metric"><span>${event.plate}</span><strong>${event.status}</strong></div>`)
    .join('');
}

function setHealthStatus(online) {
  if (online) {
    healthStatus.textContent = 'ONLINE';
    healthStatus.style.background = '#dcfce7';
    healthStatus.style.color = '#15803d';
  } else {
    healthStatus.textContent = 'OFFLINE';
    healthStatus.style.background = '#fee2e2';
    healthStatus.style.color = '#b91c1c';
  }
}

function startAudio(volume) {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (!oscillator) {
    oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    oscillator.connect(gainNode).connect(audioContext.destination);
    oscillator.start();
  }
}

function stopAudio() {
  if (oscillator) {
    oscillator.stop();
    oscillator.disconnect();
    oscillator = null;
  }
}

function showAlertModal(alert) {
  pendingAlertId = alert.id;
  alertMessage.textContent = `${alert.carrier} - ${alert.plate} (${alert.status})`;
  alertModal.classList.remove('hidden');
  startAudio(Number(settingsForm.alert_volume?.value ?? 1));
}

function hideAlertModal() {
  alertModal.classList.add('hidden');
  stopAudio();
  pendingAlertId = null;
}

confirmAlertButton.addEventListener('click', async () => {
  if (!pendingAlertId) return;
  await fetchJSON(`/api/alerts/${pendingAlertId}/confirm`, { method: 'POST' });
  hideAlertModal();
  await loadDashboard();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  try {
    await fetchJSON('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });
    loginError.textContent = '';
    showApp();
    await initialize();
  } catch (error) {
    loginError.textContent = 'Credenciais inválidas.';
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetchJSON('/api/logout', { method: 'POST' });
  window.location.reload();
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(settingsForm));
  await fetchJSON('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  settingsStatus.textContent = 'Configurações salvas.';
  setTimeout(() => {
    settingsStatus.textContent = '';
  }, 2000);
});

document.querySelectorAll('[data-export]').forEach((button) => {
  button.addEventListener('click', () => {
    const format = button.dataset.export;
    window.location.href = `/api/alerts/export?format=${format}`;
  });
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach((section) => {
      section.classList.toggle('active', section.id === target);
    });
    document.getElementById('tab-title').textContent = tab.textContent;
  });
});

[alertSearch, alertStart, alertEnd, alertCarrier, alertStatus, alertSort].forEach((input) => {
  if (input) {
    input.addEventListener('input', renderAlertsTable);
    input.addEventListener('change', renderAlertsTable);
  }
});

async function loadSettings() {
  const settings = await fetchJSON('/api/settings');
  Object.entries(settings).forEach(([key, value]) => {
    if (settingsForm[key]) {
      settingsForm[key].value = value;
    }
  });
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onopen = () => setHealthStatus(true);
  source.onerror = () => setHealthStatus(false);
  source.onmessage = async (event) => {
    const payload = JSON.parse(event.data);
    const events = Array.isArray(payload) ? payload : [payload];
    events.forEach((item) => {
      if (item.type === 'monitoring_error') {
        setHealthStatus(false);
      }
      if (item.type === 'alert') {
        realtimeEvents.innerHTML = `<li>${item.carrier} - ${item.plate} - ${item.status}</li>` + realtimeEvents.innerHTML;
      }
    });
    updateMetrics(events.filter((item) => item.type === 'status_change'));
    await loadDashboard();

    const settings = Object.fromEntries(new FormData(settingsForm));
    const targetCarrier = (settings.target_carrier || 'TRANSPORTADORA SEIS').toUpperCase();
    const critical = events.find(
      (item) => item.type === 'alert' && item.carrier.toUpperCase() === targetCarrier
    );
    if (critical) {
      showAlertModal({
        id: critical.id,
        carrier: critical.carrier,
        plate: critical.plate,
        status: critical.status
      });
    }
  };
}

async function initialize() {
  await loadSettings();
  await loadDashboard();
  connectEvents();
}

async function bootstrap() {
  try {
    await fetchJSON('/api/session');
    showApp();
    await initialize();
  } catch (error) {
    loginScreen.classList.remove('hidden');
  }
}

bootstrap();
