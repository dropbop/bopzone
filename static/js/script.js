(() => {
  'use strict';

  const API_BASE = '/api/sensor';
  const DEVICE = 'office';
  const POLL_INTERVAL = 120000; // refresh every 2 minutes
  const EVENT_POLL_INTERVAL = 60000; // refresh events every 1 minute
  const EVENT_HOURS = 72;
  const EVENT_LIMIT = 50;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const CALIBRATION_WARNING_DAYS = 7;
  const CALIBRATION_DUE_DAYS = 30;

  // Trend chart
  const TREND_WINDOW_MS = 24 * 60 * 60 * 1000;
  // Alarm thresholds (shared by the live readout and the trend reference lines)
  const CO2_WARN = 700;
  const CO2_CRIT = 1200;
  const TEMP_WARN_C = 23.3;
  const TEMP_CRIT_C = 24.4;
  // Fixed-scale bounds (CO2 ppm, temp °C) used when Trend Scale = Fixed
  const TREND_FIXED_CO2 = [400, 1600];
  const TREND_FIXED_TEMP_C = [18, 28];

  let sensorData = [];
  let eventData = [];
  let lastCalibrationEvent = null;
  let trendGeom = null;   // cached chart geometry for crosshair hit-testing
  let hover = null;       // { ts } currently hovered sample, or null

  // Unit preference settings
  const DEFAULT_SETTINGS = { tempUnit: 'C', humidityUnit: 'RH', trendScale: 'auto' };
  // humidityUnit: 'RH' = %RH, 'AH_METRIC' = g/m³, 'AH_IMPERIAL' = gr/lb
  // trendScale: 'auto' = autoscale to data, 'fixed' = fixed bounds
  let settings = { ...DEFAULT_SETTINGS };

  function loadSettings() {
    settings.tempUnit = localStorage.getItem('scada_tempUnit') || DEFAULT_SETTINGS.tempUnit;
    settings.humidityUnit = localStorage.getItem('scada_humidityUnit') || DEFAULT_SETTINGS.humidityUnit;
    settings.trendScale = localStorage.getItem('scada_trendScale') || DEFAULT_SETTINGS.trendScale;
  }

  function saveSettings() {
    localStorage.setItem('scada_tempUnit', settings.tempUnit);
    localStorage.setItem('scada_humidityUnit', settings.humidityUnit);
    localStorage.setItem('scada_trendScale', settings.trendScale);
  }

  // Temperature conversions
  function celsiusToFahrenheit(c) { return (c * 9/5) + 32; }
  function convertTemp(tempC) { return settings.tempUnit === 'F' ? celsiusToFahrenheit(tempC) : tempC; }
  function getTempUnit() { return settings.tempUnit === 'F' ? '°F' : '°C'; }

  // Humidity conversions
  // Magnus saturation vapor pressure (hPa)
  function saturationPressureHpa(tempC) {
    return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  }

  // AH (g/m³) = (Psat × RH × 2.1674) / (273.15 + T)
  function relativeToAbsoluteHumidity(rhPercent, tempC) {
    return (saturationPressureHpa(tempC) * rhPercent * 2.1674) / (273.15 + tempC);
  }

  // Grains of moisture per pound of dry air = humidity ratio × 7000, at standard
  // sea-level pressure. W = 0.62198 × Pw / (P − Pw), with Pw = Psat × RH/100.
  function relativeToGrainsPerPound(rhPercent, tempC) {
    const ATM_PRESSURE_HPA = 1013.25;
    const vaporPressure = saturationPressureHpa(tempC) * (rhPercent / 100);
    const humidityRatio = (0.62198 * vaporPressure) / (ATM_PRESSURE_HPA - vaporPressure);
    return humidityRatio * 7000;
  }

  function convertHumidity(rhPercent, tempC) {
    if (settings.humidityUnit === 'RH') return rhPercent;
    if (settings.humidityUnit === 'AH_IMPERIAL') return relativeToGrainsPerPound(rhPercent, tempC);
    return relativeToAbsoluteHumidity(rhPercent, tempC);
  }

  function getHumidityUnit() {
    if (settings.humidityUnit === 'AH_METRIC') return 'g/m³';
    if (settings.humidityUnit === 'AH_IMPERIAL') return 'gr/lb';
    return '%RH';
  }

  function applySettings() {
    const tempUnitEl = document.getElementById('temp-unit');
    const humidityUnitEl = document.getElementById('humidity-unit');
    if (tempUnitEl) tempUnitEl.textContent = getTempUnit();
    if (humidityUnitEl) humidityUnitEl.textContent = getHumidityUnit();
    updateSensorDisplay();
    drawTrend();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  // America/Chicago formatters (avoid the localized-string round-trip hack)
  const TIME_24H_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const TIME_HHMM_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const TIME_12H_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  });
  const CAL_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function formatTimestamp(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return TIME_24H_FMT.format(d);
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
      const res = await fetch(`${API_BASE}/log?device=${DEVICE}&hours=${EVENT_HOURS}&limit=${EVENT_LIMIT}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      eventData = await res.json();
      updateEventDisplay();
      updateEventLed();

      // Update calibration date from events if endpoint failed
      if (!lastCalibrationEvent && eventData.length > 0) {
        lastCalibrationEvent = findLastFRCEvent(eventData);
        if (lastCalibrationEvent) updateLastCalibration();
      }
    } catch (err) {
      console.error('Event fetch error:', err);
    }
  }

  // Find the most recent FRC success event in event data
  function findLastFRCEvent(events) {
    const frcEvent = events.find(e =>
      e.event_type === 'info' &&
      e.message &&
      e.message.includes('FRC successful')
    );
    return frcEvent ? { ts: frcEvent.ts } : null;
  }

  async function fetchLastCalibration() {
    try {
      const res = await fetch(`${API_BASE}/calibration?device=${DEVICE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Store the date string directly (or null)
      lastCalibrationEvent = data.date ? { ts: data.date } : null;

      // Fallback: if no date from endpoint, try parsing event log
      if (!lastCalibrationEvent && eventData.length > 0) {
        lastCalibrationEvent = findLastFRCEvent(eventData);
      }

      updateLastCalibration();
    } catch (err) {
      console.error('Calibration fetch error:', err);
      // Still try event fallback on error
      if (eventData.length > 0) {
        lastCalibrationEvent = findLastFRCEvent(eventData);
        updateLastCalibration();
      }
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
          <span>No events available</span>
        </div>
      `;
      return;
    }

    // Get the last reset timestamp to mark acknowledged events
    const lastReset = getLastResetTimestamp(eventData);

    // eventData is already sorted DESC by the API. Render all fetched rows;
    // the alarm list is content-sized and scrolls past its CSS max-height.
    eventData.forEach(event => {
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
      msgSpan.title = `Uptime: ${formatUptime(event.uptime)} | Heap: ${event.heap ?? 'N/A'} | Measurements: ${event.total_measurements ?? 'N/A'} | I2C Errors: ${event.i2c_errors ?? 'N/A'}`;

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
    // Alarms are cleared on device reboot. The firmware emits no dedicated reset
    // event, so anchor on the boot event ("Sensor started, serial: ...") rather
    // than any info event (routine "Health:" heartbeats are also info).
    const bootEvent = events.find(e =>
      e.event_type === 'info' &&
      e.message &&
      e.message.includes('Sensor started')
    );
    if (!bootEvent) return null;
    return new Date(bootEvent.ts);
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
  }

  function updateLastCalibration() {
    const lastCalSpan = document.getElementById('last-cal');
    if (!lastCalSpan) return;

    const setErr = () => {
      lastCalSpan.textContent = 'ERR';
      lastCalSpan.style.color = '#ff0000';
      lastCalSpan.title = 'Calibration date unavailable';
    };

    if (!lastCalibrationEvent || !lastCalibrationEvent.ts) {
      setErr();
      return;
    }

    const raw = String(lastCalibrationEvent.ts);
    let display;
    let calMs;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      // Date-only string is already the calendar date. Parse as local midnight
      // (not UTC) so the age calc doesn't shift the day west of UTC.
      display = raw;
      calMs = new Date(`${raw}T00:00:00`).getTime();
    } else {
      // Full ISO timestamp: show the America/Chicago calendar date.
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        setErr();
        return;
      }
      display = CAL_DATE_FMT.format(d); // en-CA => YYYY-MM-DD
      calMs = d.getTime();
    }

    if (Number.isNaN(calMs)) {
      setErr();
      return;
    }

    const ageDays = Math.max(0, Math.floor((Date.now() - calMs) / DAY_MS));
    lastCalSpan.textContent = display;
    if (ageDays > CALIBRATION_DUE_DAYS) {
      lastCalSpan.style.color = '#ff0000';
      lastCalSpan.title = 'Calibration older than 30 days - calibration needed';
    } else if (ageDays > CALIBRATION_WARNING_DAYS) {
      lastCalSpan.style.color = '#ffff00';
      lastCalSpan.title = 'Calibration older than 7 days';
    } else {
      lastCalSpan.style.color = '';
      lastCalSpan.title = 'Calibration current';
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
      // CO2: yellow > CO2_WARN, red > CO2_CRIT
      co2El.parentElement.classList.remove('warning', 'critical');
      if (latest.co2 > CO2_CRIT) co2El.parentElement.classList.add('critical');
      else if (latest.co2 > CO2_WARN) co2El.parentElement.classList.add('warning');
    }
    if (tempEl && latest.temp != null) {
      const displayTemp = convertTemp(latest.temp);
      tempEl.textContent = displayTemp.toFixed(1);
      // Temp thresholds in Celsius: yellow > TEMP_WARN_C, red > TEMP_CRIT_C
      tempEl.parentElement.classList.remove('warning', 'critical');
      if (latest.temp > TEMP_CRIT_C) tempEl.parentElement.classList.add('critical');
      else if (latest.temp > TEMP_WARN_C) tempEl.parentElement.classList.add('warning');
    }
    if (humidityEl && latest.humidity != null) {
      const displayHumidity = convertHumidity(latest.humidity, latest.temp);
      humidityEl.textContent = displayHumidity.toFixed(1);
      // Humidity warning only applies to %RH mode
      humidityEl.parentElement.classList.remove('warning', 'critical');
      if (settings.humidityUnit === 'RH' && latest.humidity > 80) {
        humidityEl.parentElement.classList.add('critical');
      }
    }

    // Update last update timestamp (converted to US Central Time)
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl && latest.ts) {
      const d = new Date(latest.ts);
      if (!Number.isNaN(d.getTime())) {
        const parts = {};
        for (const p of TIME_12H_FMT.formatToParts(d)) parts[p.type] = p.value;
        const ampm = (parts.dayPeriod || '').toLowerCase();
        lastUpdateEl.textContent = `${parts.hour}:${parts.minute}.${parts.second} ${ampm}`;

        // Last Update: yellow > 15 min, red > 25 min stale (adjusted for 10-min batching)
        const ageMin = (Date.now() - d.getTime()) / 60000;
        lastUpdateEl.parentElement.classList.remove('warning', 'critical');
        if (ageMin > 25) lastUpdateEl.parentElement.classList.add('critical');
        else if (ageMin > 15) lastUpdateEl.parentElement.classList.add('warning');
      }
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

  // ---- Trend chart ----------------------------------------------------------

  function median(nums) {
    if (nums.length === 0) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Parse sensorData into {ts, co2, temp} sorted ascending by time.
  function getTrendPoints() {
    return sensorData
      .map(d => ({ ts: new Date(d.ts).getTime(), co2: d.co2, temp: d.temp }))
      .filter(p => !Number.isNaN(p.ts))
      .sort((a, b) => a.ts - b.ts);
  }

  // Range for one series; null when no data. Fixed mode ignores the data.
  function seriesRange(points, key, padAmt, fixed) {
    if (settings.trendScale === 'fixed') return { min: fixed[0], max: fixed[1] };
    const vals = points.map(p => p[key]).filter(v => v != null);
    if (vals.length === 0) return null;
    return { min: Math.min(...vals) - padAmt, max: Math.max(...vals) + padAmt };
  }

  const CHICAGO_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // Chicago wall-clock components for an instant.
  function chicagoParts(date) {
    const p = {};
    for (const x of CHICAGO_PARTS_FMT.formatToParts(date)) p[x.type] = x.value;
    return {
      y: Number(p.year), mo: Number(p.month), d: Number(p.day),
      h: p.hour === '24' ? 0 : Number(p.hour),
      mi: Number(p.minute), s: Number(p.second)
    };
  }

  // Chicago UTC offset (ms to add to a UTC instant to get wall-clock) at `date`.
  function chicagoOffsetMs(date) {
    const p = chicagoParts(date);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime();
  }

  // Epoch ms for a given Chicago wall-clock time. Refines once so the offset is
  // taken at the resulting instant, not the guess (correct across DST edges).
  function chicagoWallToEpoch(y, mo, d, h) {
    const utc = Date.UTC(y, mo - 1, d, h, 0, 0);
    let e = utc - chicagoOffsetMs(new Date(utc));
    e = utc - chicagoOffsetMs(new Date(e));
    return e;
  }

  // 6h ticks aligned to round Chicago clock hours (00/06/12/18), DST-correct:
  // each tick's offset is computed independently rather than reused across the
  // window, so ticks before/after a transition stay on round hours.
  function sixHourTicks(g) {
    const SIX_H = 6 * 60 * 60 * 1000;
    const start = chicagoParts(new Date(g.tStart));
    // UTC counter used purely to step Chicago wall-clock by 6h (00→06→12→18→…).
    let wall = Date.UTC(start.y, start.mo - 1, start.d, 0, 0, 0);
    const ticks = [];
    for (let i = 0; i < 16; i++) {
      const w = new Date(wall);
      const epoch = chicagoWallToEpoch(w.getUTCFullYear(), w.getUTCMonth() + 1,
        w.getUTCDate(), w.getUTCHours());
      if (epoch > g.tEnd) break;
      if (epoch >= g.tStart) ticks.push(epoch);
      wall += SIX_H;
    }
    return ticks;
  }

  // Gap larger than this breaks the line (downtime). >= 20 min.
  function trendGapMs(points) {
    const deltas = [];
    let prev = null;
    for (const p of points) {
      if (prev != null) deltas.push(p.ts - prev);
      prev = p.ts;
    }
    return Math.max(2 * median(deltas), 20 * 60 * 1000);
  }

  function computeTrendGeom(canvas) {
    const parent = canvas.parentElement;
    const widthCSS = parent.clientWidth || 300;
    const heightCSS = parent.clientHeight || 200;
    const padding = { top: 24, right: 60, bottom: 30, left: 50 };
    const points = getTrendPoints();
    const tEnd = Date.now();
    return {
      widthCSS, heightCSS, padding,
      chartWidth: widthCSS - padding.left - padding.right,
      chartHeight: heightCSS - padding.top - padding.bottom,
      tStart: tEnd - TREND_WINDOW_MS,
      tEnd,
      points,
      co2: seriesRange(points, 'co2', 50, TREND_FIXED_CO2),
      temp: seriesRange(points, 'temp', 2, TREND_FIXED_TEMP_C),
    };
  }

  function xAt(g, ts) {
    return g.padding.left + g.chartWidth * (ts - g.tStart) / (g.tEnd - g.tStart);
  }
  function yAt(g, range, value) {
    return g.heightCSS - g.padding.bottom -
      ((value - range.min) / (range.max - range.min)) * g.chartHeight;
  }
  function crisp(v) { return Math.round(v) + 0.5; }

  // Draw one series with gap breaks. Returns the most recent drawn point.
  function drawSeries(ctx, g, range, key, color, gapMs) {
    if (!range) return null;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let prevTs = null, started = false, last = null;
    for (const p of g.points) {
      if (p[key] == null) { prevTs = null; started = false; continue; }
      if (p.ts < g.tStart) { prevTs = p.ts; continue; }
      const x = xAt(g, p.ts), y = yAt(g, range, p[key]);
      if (!started || (prevTs != null && p.ts - prevTs > gapMs)) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
      prevTs = p.ts;
      last = { x, y, value: p[key] };
    }
    ctx.stroke();
    return last;
  }

  function drawThreshold(ctx, g, range, value, color, label, side) {
    if (!range || value < range.min || value > range.max) return;
    const y = yAt(g, range, value);
    const right = g.widthCSS - g.padding.right;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(g.padding.left, crisp(y));
    ctx.lineTo(right, crisp(y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = side === 'left' ? 'left' : 'right';
    ctx.fillText(label, side === 'left' ? g.padding.left + 3 : right - 3, y - 2);
    ctx.restore();
  }

  function drawMarker(ctx, g, pt, color, label) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, Math.min(pt.x - 4, g.widthCSS - g.padding.right - 2), pt.y - 4);
  }

  function drawLegend(ctx, g) {
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left';
    const sw = 8, sy = 4;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(g.padding.left, sy, sw, sw);
    ctx.fillText('CO2 (ppm)', g.padding.left + sw + 4, 12);
    const x2 = g.padding.left + 95;
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(x2, sy, sw, sw);
    ctx.fillText('Temp (' + getTempUnit() + ')', x2 + sw + 4, 12);
  }

  function drawStats(ctx, g) {
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'right';
    const rx = g.widthCSS - g.padding.right;
    const co2 = g.points.map(p => p.co2).filter(v => v != null);
    if (co2.length) {
      const avg = co2.reduce((a, b) => a + b, 0) / co2.length;
      ctx.fillStyle = '#00ff00';
      ctx.fillText(`CO2 ${Math.round(Math.min(...co2))}/${Math.round(avg)}/${Math.round(Math.max(...co2))}`, rx, 9);
    }
    const temp = g.points.map(p => p.temp).filter(v => v != null);
    if (temp.length) {
      const avg = temp.reduce((a, b) => a + b, 0) / temp.length;
      ctx.fillStyle = '#ff6600';
      ctx.fillText(`T ${convertTemp(Math.min(...temp)).toFixed(1)}/${convertTemp(avg).toFixed(1)}/${convertTemp(Math.max(...temp)).toFixed(1)}`, rx, 18);
    }
  }

  function nearestSample(points, ts) {
    if (points.length === 0) return null;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].ts < ts) lo = mid + 1; else hi = mid;
    }
    const cand = lo > 0 ? [points[lo], points[lo - 1]] : [points[lo]];
    return cand.reduce((best, p) => Math.abs(p.ts - ts) < Math.abs(best.ts - ts) ? p : best);
  }

  function drawCrosshair(ctx, g) {
    const sample = nearestSample(g.points, hover.ts);
    if (!sample) return;
    const x = xAt(g, sample.ts);
    const left = g.padding.left, right = g.widthCSS - g.padding.right;
    if (x < left || x > right) return;
    const top = g.padding.top, bottom = g.heightCSS - g.padding.bottom;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(crisp(x), top);
    ctx.lineTo(crisp(x), bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const rows = [{ c: '#ffffff', t: TIME_HHMM_FMT.format(new Date(sample.ts)) }];
    if (g.co2 && sample.co2 != null) {
      const y = yAt(g, g.co2, sample.co2);
      ctx.fillStyle = '#00ff00';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      rows.push({ c: '#00ff00', t: `CO2 ${Math.round(sample.co2)} ppm` });
    }
    if (g.temp && sample.temp != null) {
      const y = yAt(g, g.temp, sample.temp);
      ctx.fillStyle = '#ff6600';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      rows.push({ c: '#ff6600', t: `T ${convertTemp(sample.temp).toFixed(1)}${getTempUnit()}` });
    }

    ctx.font = '9px "Courier New", monospace';
    const tw = Math.max(...rows.map(r => ctx.measureText(r.t).width)) + 12;
    const th = rows.length * 12 + 6;
    let bx = x + 8;
    if (bx + tw > right) bx = x - 8 - tw;
    const by = top + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(bx, by, tw, th);
    ctx.strokeStyle = '#5f9f5f';
    ctx.strokeRect(crisp(bx), crisp(by), tw, th);
    ctx.textAlign = 'left';
    rows.forEach((r, i) => {
      ctx.fillStyle = r.c;
      ctx.fillText(r.t, bx + 6, by + 12 + i * 12);
    });
    ctx.restore();
  }

  function drawTrend() {
    const canvas = document.getElementById('trend-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
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

    const g = computeTrendGeom(canvas);
    trendGeom = g;

    if (g.points.length < 2 || (!g.co2 && !g.temp)) {
      ctx.fillStyle = '#00ff00';
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText('Waiting for sensor data...', 10, heightCSS / 2);
      return;
    }

    const { padding, chartWidth, chartHeight } = g;
    const left = padding.left, right = widthCSS - padding.right;
    const top = padding.top, bottom = heightCSS - padding.bottom;
    const ticks = sixHourTicks(g);

    // Gridlines
    ctx.strokeStyle = '#0a2a0a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = crisp(bottom - chartHeight * i / 4);
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    for (const t of ticks) {
      const x = crisp(xAt(g, t));
      ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    }
    ctx.stroke();

    // Threshold reference lines (in-range only)
    drawThreshold(ctx, g, g.co2, CO2_WARN, '#00aa00', String(CO2_WARN), 'left');
    drawThreshold(ctx, g, g.co2, CO2_CRIT, '#00aa00', String(CO2_CRIT), 'left');
    drawThreshold(ctx, g, g.temp, TEMP_WARN_C, '#cc6600', convertTemp(TEMP_WARN_C).toFixed(1) + '°', 'right');
    drawThreshold(ctx, g, g.temp, TEMP_CRIT_C, '#cc6600', convertTemp(TEMP_CRIT_C).toFixed(1) + '°', 'right');

    // Axes (L-shape)
    ctx.strokeStyle = '#004400';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crisp(left), top);
    ctx.lineTo(crisp(left), crisp(bottom));
    ctx.lineTo(right, crisp(bottom));
    ctx.stroke();

    // Y-axis labels
    ctx.font = '9px "Courier New", monospace';
    if (g.co2) {
      ctx.fillStyle = '#00ff00';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const val = g.co2.min + (g.co2.max - g.co2.min) * (i / 4);
        ctx.fillText(Math.round(val) + '', left - 5, bottom - chartHeight * i / 4 + 3);
      }
    }
    if (g.temp) {
      ctx.fillStyle = '#ff6600';
      ctx.textAlign = 'left';
      for (let i = 0; i <= 4; i++) {
        const valC = g.temp.min + (g.temp.max - g.temp.min) * (i / 4);
        ctx.fillText(convertTemp(valC).toFixed(1) + '°', right + 5, bottom - chartHeight * i / 4 + 3);
      }
    }

    // X-axis time labels
    ctx.fillStyle = '#008800';
    ctx.textAlign = 'center';
    for (const t of ticks) {
      ctx.fillText(TIME_HHMM_FMT.format(new Date(t)), xAt(g, t), bottom + 15);
    }

    // Series (clipped to the plot rect so fixed-scale overflow stays in-bounds)
    const gapMs = trendGapMs(g.points);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, chartWidth, chartHeight);
    ctx.clip();
    const lastCo2 = drawSeries(ctx, g, g.co2, 'co2', '#00ff00', gapMs);
    const lastTemp = drawSeries(ctx, g, g.temp, 'temp', '#ff6600', gapMs);
    ctx.restore();

    // Most-recent value markers
    if (lastCo2) drawMarker(ctx, g, lastCo2, '#00ff00', String(Math.round(lastCo2.value)));
    if (lastTemp) drawMarker(ctx, g, lastTemp, '#ff6600', convertTemp(lastTemp.value).toFixed(1) + '°');

    drawLegend(ctx, g);
    drawStats(ctx, g);

    if (hover) drawCrosshair(ctx, g);
  }

  // Crosshair interactivity (mouse + touch via Pointer Events)
  let trendRAF = 0;
  function scheduleTrendRedraw() {
    if (trendRAF) return;
    trendRAF = requestAnimationFrame(() => { trendRAF = 0; drawTrend(); });
  }
  function trendPointerMove(e) {
    const g = trendGeom;
    if (!g) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < g.padding.left || x > g.widthCSS - g.padding.right) {
      if (hover) { hover = null; scheduleTrendRedraw(); }
      return;
    }
    hover = { ts: g.tStart + (x - g.padding.left) / g.chartWidth * (g.tEnd - g.tStart) };
    scheduleTrendRedraw();
  }
  function trendPointerClear() {
    if (hover) { hover = null; scheduleTrendRedraw(); }
  }
  function initTrendInteractivity() {
    const canvas = document.getElementById('trend-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointermove', trendPointerMove);
    canvas.addEventListener('pointerdown', trendPointerMove);
    canvas.addEventListener('pointerleave', trendPointerClear);
    canvas.addEventListener('pointerup', trendPointerClear);
    canvas.addEventListener('pointercancel', trendPointerClear);
  }

  function renderConfigPopup(container) {
    container.innerHTML = `
      <div class="config-section">
        <div class="config-label">Temperature Unit</div>
        <div class="config-options">
          <label class="config-radio">
            <input type="radio" name="tempUnit" value="C" ${settings.tempUnit === 'C' ? 'checked' : ''}>
            Celsius (°C)
          </label>
          <label class="config-radio">
            <input type="radio" name="tempUnit" value="F" ${settings.tempUnit === 'F' ? 'checked' : ''}>
            Fahrenheit (°F)
          </label>
        </div>
      </div>
      <div class="config-section">
        <div class="config-label">Humidity Unit</div>
        <div class="config-options">
          <label class="config-radio">
            <input type="radio" name="humidityUnit" value="RH" ${settings.humidityUnit === 'RH' ? 'checked' : ''}>
            Relative (%RH)
          </label>
          <label class="config-radio">
            <input type="radio" name="humidityUnit" value="AH_METRIC" ${settings.humidityUnit === 'AH_METRIC' ? 'checked' : ''}>
            Absolute (g/m³)
          </label>
          <label class="config-radio">
            <input type="radio" name="humidityUnit" value="AH_IMPERIAL" ${settings.humidityUnit === 'AH_IMPERIAL' ? 'checked' : ''}>
            Absolute (gr/lb)
          </label>
        </div>
      </div>
      <div class="config-section">
        <div class="config-label">Trend Scale</div>
        <div class="config-options">
          <label class="config-radio">
            <input type="radio" name="trendScale" value="auto" ${settings.trendScale === 'auto' ? 'checked' : ''}>
            Auto (fit to data)
          </label>
          <label class="config-radio">
            <input type="radio" name="trendScale" value="fixed" ${settings.trendScale === 'fixed' ? 'checked' : ''}>
            Fixed (${TREND_FIXED_CO2[0]}–${TREND_FIXED_CO2[1]} ppm)
          </label>
        </div>
      </div>
    `;

    // Add event listeners for immediate apply
    container.querySelectorAll('input[name="tempUnit"]').forEach(input => {
      input.addEventListener('change', (e) => {
        settings.tempUnit = e.target.value;
        saveSettings();
        applySettings();
      });
    });

    container.querySelectorAll('input[name="humidityUnit"]').forEach(input => {
      input.addEventListener('change', (e) => {
        settings.humidityUnit = e.target.value;
        saveSettings();
        applySettings();
      });
    });

    container.querySelectorAll('input[name="trendScale"]').forEach(input => {
      input.addEventListener('change', (e) => {
        settings.trendScale = e.target.value;
        saveSettings();
        drawTrend();
      });
    });
  }

  function renderOverviewPopup(container) {
    container.innerHTML = `
      <div class="config-section">
        <div class="config-label">System Overview</div>
        <p class="overview-text">
          Environmental monitoring dashboard for the office SCD41 CO2 /
          temperature / humidity sensor. Live readings, 24-hour trend, and event
          log are served through a Flask proxy.
        </p>
      </div>
      <div class="config-section">
        <div class="config-label">Source Code</div>
        <a class="source-link" href="https://github.com/dropbop/bopzone" target="_blank" rel="noopener noreferrer">
          <span class="source-link-icon" aria-hidden="true"></span>
          <span>github.com/dropbop/bopzone</span>
        </a>
      </div>
    `;
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

    // Populate body based on popup type
    if (title === 'Config') {
      renderConfigPopup(body);
    } else if (title === 'Overview') {
      renderOverviewPopup(body);
    }

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
    // Load saved settings first
    loadSettings();
    applySettings();

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

    // Trend crosshair (mouse + touch)
    initTrendInteractivity();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
