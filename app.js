// ---- Bike Trip Tracker logic ----

const statusEl = document.getElementById('status');
const speedEl = document.getElementById('speed');
const distEl = document.getElementById('distance');
const durEl = document.getElementById('duration');
const accEl = document.getElementById('accuracy');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const tripsEl = document.getElementById('trips');

let watchId = null;
let tracking = false;
let lastPos = null;
let distanceKm = 0;
let startTime = null;
let timerInterval = null;

// auto start/stop helpers
let aboveSpeedSince = null;   // timestamp when speed first went >= 5 km/h
let belowSpeedSince = null;   // timestamp when speed first dropped <= 1 km/h (while tracking)
const AUTO_START_SPEED = 5;   // km/h
const AUTO_START_HOLD_MS = 10 * 1000;      // 10 seconds
const AUTO_STOP_SPEED = 1;    // km/h
const AUTO_STOP_HOLD_MS = 5 * 60 * 1000;   // 5 minutes

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startWatching() {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
}

function onError(err) {
  statusEl.textContent = 'GPS error: ' + err.message;
}

function onPosition(pos) {
  const { latitude, longitude, speed, accuracy } = pos.coords;
  accEl.textContent = accuracy ? Math.round(accuracy) : '--';

  // speed in km/h — prefer device-reported speed, fall back to computed
  let kmh = 0;
  if (typeof speed === 'number' && speed !== null && !isNaN(speed)) {
    kmh = speed * 3.6;
  } else if (lastPos) {
    const dKm = haversineKm(lastPos.lat, lastPos.lon, latitude, longitude);
    const dHr = (pos.timestamp - lastPos.t) / 3600000;
    kmh = dHr > 0 ? dKm / dHr : 0;
  }
  if (kmh < 0 || isNaN(kmh)) kmh = 0;
  speedEl.textContent = kmh.toFixed(1);

  handleAutoLogic(kmh);

  if (tracking) {
    if (lastPos) {
      const d = haversineKm(lastPos.lat, lastPos.lon, latitude, longitude);
      if (d > 0.002) distanceKm += d; // ignore GPS jitter under 2m
      distEl.textContent = distanceKm.toFixed(2);
    }
  }

  lastPos = { lat: latitude, lon: longitude, t: pos.timestamp };
  window._lastCoords = { lat: latitude, lon: longitude };
}

function handleAutoLogic(kmh) {
  const now = Date.now();

  if (!tracking) {
    if (kmh >= AUTO_START_SPEED) {
      if (!aboveSpeedSince) aboveSpeedSince = now;
      if (now - aboveSpeedSince >= AUTO_START_HOLD_MS) {
        startTrip(true);
      }
    } else {
      aboveSpeedSince = null;
    }
  } else {
    if (kmh <= AUTO_STOP_SPEED) {
      if (!belowSpeedSince) belowSpeedSince = now;
      if (now - belowSpeedSince >= AUTO_STOP_HOLD_MS) {
        stopTrip(true);
      }
    } else {
      belowSpeedSince = null;
    }
  }
}

function startTrip(auto) {
  tracking = true;
  distanceKm = 0;
  startTime = Date.now();
  belowSpeedSince = null;
  aboveSpeedSince = null;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = auto ? 'Trip auto-started 🚲' : 'Trip started 🚲';
  distEl.textContent = '0.00';

  timerInterval = setInterval(() => {
    durEl.textContent = fmtDuration(Date.now() - startTime);
  }, 1000);
}

async function stopTrip(auto) {
  tracking = false;
  clearInterval(timerInterval);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = auto ? 'Trip auto-stopped.' : 'Trip stopped.';

  const durationMs = Date.now() - startTime;
  const coords = window._lastCoords;
  const mapsLink = coords
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lon}`
    : null;

  const trip = {
    date: new Date().toLocaleString(),
    distanceKm: distanceKm.toFixed(2),
    duration: fmtDuration(durationMs),
    mapsLink,
    place: null
  };

  saveTrip(trip);
  renderTrips();

  if (coords) {
    const place = await reverseGeocode(coords.lat, coords.lon);
    if (place) {
      trip.place = place;
      updateLastTripPlace(place);
      renderTrips();
    }
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

function getTrips() {
  const today = new Date().toDateString();
  const raw = localStorage.getItem('bikeTrips_' + today);
  return raw ? JSON.parse(raw) : [];
}

function saveTrip(trip) {
  const today = new Date().toDateString();
  const trips = getTrips();
  trips.unshift(trip);
  localStorage.setItem('bikeTrips_' + today, JSON.stringify(trips));
}

function updateLastTripPlace(place) {
  const today = new Date().toDateString();
  const trips = getTrips();
  if (trips.length) {
    trips[0].place = place;
    localStorage.setItem('bikeTrips_' + today, JSON.stringify(trips));
  }
}

function renderTrips() {
  const trips = getTrips();
  if (!trips.length) {
    tripsEl.innerHTML = '<li class="muted">No trips yet.</li>';
    return;
  }
  tripsEl.innerHTML = trips.map(t => `
    <li>
      <strong>${t.distanceKm} km</strong> · ${t.duration} · <span class="muted">${t.date}</span><br>
      ${t.place ? t.place : (t.mapsLink ? '<span class="muted">Locating…</span>' : '')}
      ${t.mapsLink ? ` · <a href="${t.mapsLink}" target="_blank">map</a>` : ''}
    </li>
  `).join('');
}

startBtn.addEventListener('click', () => startTrip(false));
stopBtn.addEventListener('click', () => stopTrip(false));

if ('geolocation' in navigator) {
  startWatching();
} else {
  statusEl.textContent = 'Geolocation not supported on this device.';
}

renderTrips();
