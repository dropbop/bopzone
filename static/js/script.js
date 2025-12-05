(() => {
  'use strict';

  const API_BASE = '/api/sensor';
  const DEVICE = 'office';
  const POLL_INTERVAL = 60000; // refresh every 60 seconds

  let sensorData = [];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
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

  function updateSensorDisplay() {
    if (sensorData.length === 0) return;
    
    // Get most recent reading
    const latest = sensorData[sensorData.length - 1];
    
    const co2El = document.getElementById('co2');
    const tempEl = document.getElementById('temp');
    const humidityEl = document.getElementById('humidity');
    
    if (co2El && latest.co2 != null) {
      co2El.textContent = String(latest.co2).padStart(4, '0');
    }
    if (tempEl && latest.temp != null) {
      tempEl.textContent = latest.temp.toFixed(1);
    }
    if (humidityEl && latest.humidity != null) {
      humidityEl.textContent = latest.humidity.toFixed(1);
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

    // Poll for updates
    setInterval(fetchSensorData, POLL_INTERVAL);

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
