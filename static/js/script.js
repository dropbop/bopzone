(() => {
  'use strict';

  const API_BASE = '/api/sensor';
  const DEVICE = 'office';
  const POLL_INTERVAL = 60000; // refresh every 60 seconds
  const EVENT_POLL_INTERVAL = 30000; // refresh events every 30 seconds

  let sensorData = [];
  let eventData = [];
  let lastCalibrationEvent = null;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  function formatTimestamp(isoString) {
    const d = new Date(isoString);
    const central = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return `${pad2(central.getHours())}:${pad2(central.getMinutes())}:${pad2(central.getSeconds())}`;
  }

  async function fetchSensorData() {
    try {
      const res = await fetch(`${API_BASE}?device=${DEVICE}&hours=24`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sensorData = await res.json();
      updateSensorDisplay();
      drawTrend();
      setLedStatus('esp32', sensorData.length > 0);
      setLedStatus('db', true);
    } catch (err) {
      console.error('Fetch error:', err);
      setLedStatus('esp32', false);
      setLedStatus('db', false);
    }
  }

  async function fetchEvents() {
    try {
      const res = await fetch(`${API_BASE}/log?device=${DEVICE}&hours=24&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      eventData = await res.json();
      updateEventDisplay();
      updateEventLed();
    } catch (err) {
      console.error('Event fetch error:', err);
    }
  }

  async function fetchLastCalibration() {
    try {
      // Query last 30 days of events to find calibration
      const res = await fetch(`${API_BASE}/log?device=${DEVICE}&hours=720&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = await res.json();
      // Find most recent FRC successful event
      lastCalibrationEvent = events.find(e => e.message && e.message.includes('FRC successful')) || null;
      updateLastCalibration();
    } catch (err) {
      console.error('Calibration fetch error:', err);
    }
  }

  function updateEventDisplay() {
    const alarmList = document.getElementById('alarm-list');
    if (!alarmList) return;

    // Clear existing content
    alarmList.innerHTML = '';

    if (eventData.length === 0) {
      alarmList.innerHTML = `
        <div class="alarm-row normal">
          <span>--:--:--</span>
          <span>INFO</span>
          <span>No events in the last 24 hours</span>
        </div>
      `;
      return;
    }

    // Get the last reset timestamp to mark acknowledged events
    const lastReset = getLastResetTimestamp(eventData);

    // eventData is already sorted DESC by the API, but we want to show newest first
    // Limit to 20 most recent for display
    const displayEvents = eventData.slice(0, 20);

    displayEvents.forEach(event => {
      const row = document.createElement('div');
      const eventTime = new Date(event.ts);
      const isAcknowledged = lastReset && eventTime < lastReset && event.event_type !== 'info';

      row.className = `alarm-row ${getEventClass(event.event_type)}`;
      if (isAcknowledged) {
        row.classList.add('acknowledged');
      }

      const timeSpan = document.createElement('span');
      timeSpan.textContent = formatTimestamp(event.ts);

      const typeSpan = document.createElement('span');
      typeSpan.textContent = event.event_type.toUpperCase();

      const msgSpan = document.createElement('span');
      msgSpan.textContent = event.message;
      msgSpan.title = `Uptime: ${formatUptime(event.uptime)} | Heap: ${event.heap} bytes | Measurements: ${event.total_measurements}`;

      row.appendChild(timeSpan);
      row.appendChild(typeSpan);
      row.appendChild(msgSpan);
      alarmList.appendChild(row);
    });
  }

  function getEventClass(eventType) {
    switch (eventType) {
      case 'critical': return 'critical';
      case 'error': return 'critical';
      case 'warning': return 'warning';
      default: return 'normal';
    }
  }

  function formatUptime(seconds) {
    if (seconds == null) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  function getLastResetTimestamp(events) {
    // Find the most recent info event - this marks when alarms were "reset"
    const infoEvent = events.find(e => e.event_type === 'info');
    if (!infoEvent) return null;
    return new Date(infoEvent.ts);
  }

  function updateEventLed() {
    // Check for recent errors/critical events (last hour, after last reset)
    const oneHourAgo = new Date(Date.now() - 3600000);
    const lastReset = getLastResetTimestamp(eventData);

    // Only count alarms that occurred after the last reset (info event)
    const isActiveAlarm = (e) => {
      if (e.event_type !== 'critical' && e.event_type !== 'error') return false;
      const eventTime = new Date(e.ts);
      if (eventTime <= oneHourAgo) return false;
      if (lastReset && eventTime <= lastReset) return false;
      return true;
    };

    const recentCritical = eventData.some(isActiveAlarm);

    const alarmLed = document.querySelector('[aria-label="Alarm status"] .led');
    if (alarmLed) {
      alarmLed.classList.remove('green-on', 'red-on', 'yellow-on');
      if (recentCritical) {
        alarmLed.classList.add('red-on');
      }
    }

    // Update alarm count in panel title
    const activeAlarms = eventData.filter(isActiveAlarm).length;
    const alarmCountSpan = document.getElementById('alarm-count');
    if (alarmCountSpan) {
      alarmCountSpan.textContent = `${activeAlarms} ACTIVE`;
      alarmCountSpan.style.color = activeAlarms > 0 ? '#ff0000' : 'inherit';
    }

    // Update last calibration date
    updateLastCalibration();
  }

  function updateLastCalibration() {
    const lastCalSpan = document.getElementById('last-cal');
    if (!lastCalSpan) return;

    // Check recent events first (may have just calibrated)
    const recentFrc = eventData.find(e => e.message && e.message.includes('FRC successful'));
    const frcEvent = recentFrc || lastCalibrationEvent;

    if (frcEvent) {
      const calDate = new Date(frcEvent.ts);
      const yyyy = calDate.getFullYear();
      const mm = String(calDate.getMonth() + 1).padStart(2, '0');
      const dd = String(calDate.getDate()).padStart(2, '0');
      lastCalSpan.textContent = `${yyyy}-${mm}-${dd}`;
    } else {
      lastCalSpan.textContent = '----';
    }
  }

  function updateSensorDisplay() {
    if (sensorData.length === 0) return;
    
    // Get most recent reading
    const latest = sensorData[sensorData.length - 1];
    
    const co2El = document.getElementById('co2');
    const tempEl = document.getElementById('temp');
    const humidityEl = document.getElementById('humidity');
    
    if (co2El && latest.co2 != null) {
      co2El.textContent = String(latest.co2).padStart(4, '0');
      // CO2: yellow > 700, red > 1200
      co2El.parentElement.classList.remove('warning', 'critical');
      if (latest.co2 > 1200) co2El.parentElement.classList.add('critical');
      else if (latest.co2 > 700) co2El.parentElement.classList.add('warning');
    }
    if (tempEl && latest.temp != null) {
      tempEl.textContent = latest.temp.toFixed(1);
      // Temp: yellow > 23.3°C (74°F), red > 24.4°C (76°F)
      tempEl.parentElement.classList.remove('warning', 'critical');
      if (latest.temp > 24.4) tempEl.parentElement.classList.add('critical');
      else if (latest.temp > 23.3) tempEl.parentElement.classList.add('warning');
    }
    if (humidityEl && latest.humidity != null) {
      humidityEl.textContent = latest.humidity.toFixed(1);
      // Humidity: red > 80%
      humidityEl.parentElement.classList.remove('warning', 'critical');
      if (latest.humidity > 80) humidityEl.parentElement.classList.add('critical');
    }

    // Update last update timestamp (converted to US Central Time)
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl && latest.ts) {
      const d = new Date(latest.ts);
      const central = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const month = pad2(central.getMonth() + 1);
      const day = pad2(central.getDate());
      const year = String(central.getFullYear()).slice(-2);
      let hour = central.getHours();
      const ampm = hour >= 12 ? 'pm' : 'am';
      hour = hour % 12 || 12;
      const minute = pad2(central.getMinutes());
      const second = pad2(central.getSeconds());
      lastUpdateEl.textContent = `${hour}:${minute}.${second} ${ampm}`;

      // Last Update: yellow > 5 min, red > 15 min stale
      const ageMs = Date.now() - d.getTime();
      const ageMin = ageMs / 60000;
      lastUpdateEl.parentElement.classList.remove('warning', 'critical');
      if (ageMin > 15) lastUpdateEl.parentElement.classList.add('critical');
      else if (ageMin > 5) lastUpdateEl.parentElement.classList.add('warning');
    }
  }

  function setLedStatus(name, isOn) {
    const led = document.querySelector(`[aria-label="${name.toUpperCase()} status"] .led`);
    if (!led) return;
    led.classList.remove('green-on', 'red-on', 'yellow-on');
    if (isOn) {
      led.classList.add('green-on');
    }
  }

  function drawTrend() {
    const canvas = document.getElementById('trend-canvas');
    if (!canvas) return;

    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const widthCSS = parent.clientWidth || 300;
    const heightCSS = parent.clientHeight || 200;

    canvas.width = Math.max(1, Math.floor(widthCSS * dpr));
    canvas.height = Math.max(1, Math.floor(heightCSS * dpr));
    canvas.style.width = widthCSS + 'px';
    canvas.style.height = heightCSS + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthCSS, heightCSS);

    if (sensorData.length < 2) {
      // No data yet - show placeholder text
      ctx.fillStyle = '#00ff00';
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText('Waiting for sensor data...', 10, heightCSS / 2);
      return;
    }

    const padding = { top: 20, right: 60, bottom: 30, left: 50 };
    const chartWidth = widthCSS - padding.left - padding.right;
    const chartHeight = heightCSS - padding.top - padding.bottom;

    // Extract CO2 values and find range
    const co2Values = sensorData.map(d => d.co2).filter(v => v != null);
    const tempValues = sensorData.map(d => d.temp).filter(v => v != null);
    
    const co2Min = Math.min(...co2Values) - 50;
    const co2Max = Math.max(...co2Values) + 50;
    const tempMin = Math.min(...tempValues) - 2;
    const tempMax = Math.max(...tempValues) + 2;

    // Draw axes
    ctx.strokeStyle = '#004400';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, heightCSS - padding.bottom);
    ctx.lineTo(widthCSS - padding.right, heightCSS - padding.bottom);
    ctx.stroke();

    // Y-axis labels (CO2 - left side)
    ctx.fillStyle = '#00ff00';
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = co2Min + (co2Max - co2Min) * (i / 4);
      const y = heightCSS - padding.bottom - (chartHeight * i / 4);
      ctx.fillText(Math.round(val) + '', padding.left - 5, y + 3);
    }

    // Y-axis labels (Temp - right side)
    ctx.fillStyle = '#ff6600';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const val = tempMin + (tempMax - tempMin) * (i / 4);
      const y = heightCSS - padding.bottom - (chartHeight * i / 4);
      ctx.fillText(val.toFixed(1) + '°', widthCSS - padding.right + 5, y + 3);
    }

    // X-axis time labels
    ctx.fillStyle = '#008800';
    ctx.textAlign = 'center';
    const timePoints = [0, Math.floor(sensorData.length / 2), sensorData.length - 1];
    timePoints.forEach(idx => {
      if (idx >= sensorData.length) return;
      const d = new Date(sensorData[idx].ts);
      const label = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      const x = padding.left + (chartWidth * idx / (sensorData.length - 1));
      ctx.fillText(label, x, heightCSS - padding.bottom + 15);
    });

    // Draw CO2 line (green)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sensorData.forEach((d, i) => {
      if (d.co2 == null) return;
      const x = padding.left + (chartWidth * i / (sensorData.length - 1));
      const y = heightCSS - padding.bottom - ((d.co2 - co2Min) / (co2Max - co2Min)) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw temperature line (orange)
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sensorData.forEach((d, i) => {
      if (d.temp == null) return;
      const x = padding.left + (chartWidth * i / (sensorData.length - 1));
      const y = heightCSS - padding.bottom - ((d.temp - tempMin) / (tempMax - tempMin)) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Legend
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = '#00ff00';
    ctx.textAlign = 'left';
    ctx.fillText('■ CO2 (ppm)', padding.left, 12);
    ctx.fillStyle = '#ff6600';
    ctx.fillText('■ Temp (°C)', padding.left + 80, 12);
  }

  function openPopup(title) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';

    // Create window
    const popup = document.createElement('div');
    popup.className = 'popup-window';

    // Create titlebar
    const titlebar = document.createElement('div');
    titlebar.className = 'popup-titlebar';
    titlebar.innerHTML = `<span>${title}</span>`;

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'popup-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => overlay.remove();
    titlebar.appendChild(closeBtn);

    // Create body
    const body = document.createElement('div');
    body.className = 'popup-body';

    popup.appendChild(titlebar);
    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Close on overlay click (not popup itself)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Close on Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function initToolbarButtons() {
    const buttons = document.querySelectorAll('.toolbar-btn[data-popup]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        openPopup(btn.dataset.popup);
      });
    });
  }

  function init() {
    updateClock();
    setInterval(updateClock, 1000);

    // Initial fetch
    fetchSensorData();
    fetchEvents();
    fetchLastCalibration();

    // Poll for updates
    setInterval(fetchSensorData, POLL_INTERVAL);
    setInterval(fetchEvents, EVENT_POLL_INTERVAL);

    // Resize handling
    window.addEventListener('resize', drawTrend);
    window.addEventListener('orientationchange', drawTrend);

    // Toolbar popup buttons
    initToolbarButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();