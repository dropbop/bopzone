(() => {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  function updateSensors() {
    const co2 = document.getElementById('co2');
    const temp = document.getElementById('temp');
    const humidity = document.getElementById('humidity');
    if (co2) co2.textContent = String(Math.floor(Math.random() * 400 + 600)).padStart(4, '0');
    if (temp) temp.textContent = (Math.random() * 5 + 21).toFixed(1);
    if (humidity) humidity.textContent = (Math.random() * 20 + 40).toFixed(1);
  }

  function drawTrend() {
    const canvas = document.getElementById('trend-canvas');
    if (!canvas) return;

    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const widthCSS = parent.clientWidth || 300;
    const heightCSS = parent.clientHeight || 200;

    // Set the canvas size accounting for device pixel ratio for crisp lines
    canvas.width = Math.max(1, Math.floor(widthCSS * dpr));
    canvas.height = Math.max(1, Math.floor(heightCSS * dpr));
    canvas.style.width = widthCSS + 'px';
    canvas.style.height = heightCSS + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset transform then scale for DPR
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, widthCSS, heightCSS);

    // Simple trend line with a bit of noise
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < widthCSS; x += 5) {
      const y = heightCSS / 2 + Math.sin(x * 0.02) * (heightCSS * 0.15) + Math.random() * 10;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function init() {
    updateClock();
    updateSensors();
    drawTrend();

    // Timers
    setInterval(updateClock, 1000);
    setInterval(updateSensors, 3000);

    // Keep canvas sized correctly
    window.addEventListener('resize', drawTrend);
    window.addEventListener('orientationchange', drawTrend);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
