(() => {
  let clinics = [];
  const defaultCenter = [-6.2417, 106.6268];
  const recentKey = "oriskin-locator-recent";
  const themeKey = "oriskin-locator-theme";
  const map = L.map("map", { zoomControl: false }).setView([-2.5, 118], 5);
  const markers = new Map();
  const markerLayer = L.featureGroup().addTo(map);
  let searchLocationMarker = null;
  const clinicList = document.querySelector("#clinic-list");
  const searchInput = document.querySelector("#search-input");
  const searchButton = document.querySelector('#search-form button[type="submit"]');
  const toast = document.querySelector("#toast");
  const dataStatus = document.querySelector("#data-status");
  const cityFilter = document.querySelector("#city-filter");
  const logsDialog = document.querySelector("#logs-dialog");
  const logsStatus = document.querySelector("#logs-status");
  const logsList = document.querySelector("#logs-list");
  let currentCenter = defaultCenter;
  let routeOrigin = null;
  let routeLine = null;
  let routeRequestController = null;
  let routeRequestSequence = 0;
  let radiusMode = false;
  let allowNearestFallback = false;
  let nearestFallbackMode = false;
  let searchSequence = 0;
  let lastGeocodeAt = 0;
  const geocodeCache = new Map();
  let visibleClinics = clinics.slice();
  let toastTimer;
  let searchLogWarningShown = false;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  document.querySelector("#clinic-total").textContent = clinics.length;

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("id")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          value += character;
        }
      } else if (character === '"' && value.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(value);
        value = "";
      } else if (character === "\n" || character === "\r") {
        row.push(value);
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        value = "";
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      } else {
        value += character;
      }
    }

    if (quoted) throw new Error("Format CSV tidak valid: ada tanda kutip yang belum ditutup.");
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  function clinicsFromCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("Spreadsheet belum berisi baris data klinik.");

    const headers = rows[0].map((header) => normalize(header).replace(/[^a-z0-9]/g, ""));
    const column = (...names) => headers.findIndex((header) => names.includes(header));
    const columns = {
      id: column("id", "clinicid", "kode", "kodeklinik"),
      name: column("name", "namaklinik", "namacabang", "clinicname"),
      city: column("city", "kota", "kabupaten", "kotakabupaten"),
      address: column("address", "alamat", "alamatlengkap"),
      hours: column("hours", "jam", "jamoperasional", "operationalhours"),
      phone: column("phone", "telepon", "nomortelepon", "nohp"),
      whatsapp: column("whatsapp", "wa", "nomorwhatsapp"),
      status: column("status", "statusklinik", "keikutsertaan", "statusprogram"),
      mapsUrl: column("googlemaps", "googlemapslink", "mapslink", "linkgooglemaps", "linkmaps"),
      latitude: column("latitude", "lat"),
      longitude: column("longitude", "lng", "lon", "long"),
      keywords: column("keywords", "katakunci"),
    };

    const missing = ["id", "name", "city", "address", "latitude", "longitude"].filter(
      (key) => columns[key] === -1,
    );
    if (missing.length) {
      throw new Error(`Kolom wajib belum ditemukan: ${missing.join(", ")}.`);
    }

    const ids = new Set();
    const clinicsFromRows = rows.slice(1).map((cells, index) => {
      const rowNumber = index + 2;
      const cell = (key) => (columns[key] === -1 ? "" : (cells[columns[key]] || "").trim());
      const id = cell("id");
      const name = cell("name");
      const city = cell("city");
      const address = cell("address");
      const rawStatus = cell("status").toLocaleLowerCase("id");
      const mapsUrl = cell("mapsUrl");
      const latitudeValue = cell("latitude");
      const longitudeValue = cell("longitude");
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);

      if (!id || !name || !city || !address) {
        throw new Error(`ID, nama, kota, dan alamat wajib diisi (baris ${rowNumber}).`);
      }
      if (ids.has(id)) throw new Error(`ID klinik "${id}" duplikat (baris ${rowNumber}).`);
      const status =
        rawStatus === "" || rawStatus === "ya" || rawStatus === "berjalan"
          ? "ya"
          : rawStatus === "tidak" || rawStatus === "tidak ikut program"
            ? "tidak"
            : rawStatus === "hold" || rawStatus === "di hold untuk program"
              ? "hold"
              : rawStatus === "stop" || rawStatus === "berhenti"
              ? "stop"
              : "";
      if (!status) {
        throw new Error(`Status harus "ya", "tidak", "hold", atau "stop" (baris ${rowNumber}).`);
      }
      if (mapsUrl) {
        let parsedMapsUrl;
        try {
          parsedMapsUrl = new URL(mapsUrl);
        } catch (error) {
          throw new Error(`Link Google Maps tidak valid (baris ${rowNumber}).`);
        }
        const host = parsedMapsUrl.hostname.toLowerCase();
        if (
          parsedMapsUrl.protocol !== "https:" ||
          !(host === "google.com" || host.endsWith(".google.com") || host === "maps.app.goo.gl" || host === "goo.gl")
        ) {
          throw new Error(`Link Google Maps harus berupa URL HTTPS dari Google Maps (baris ${rowNumber}).`);
        }
      }
      if (
        !latitudeValue ||
        !longitudeValue ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new Error(`Koordinat tidak valid (baris ${rowNumber}).`);
      }
      ids.add(id);

      return {
        id,
        name,
        city,
        address,
        status,
        mapsUrl,
        hours: cell("hours"),
        phone: cell("phone"),
        whatsapp: cell("whatsapp").replace(/\D/g, ""),
        coordinates: [latitude, longitude],
        keywords: cell("keywords")
          .split(/[;,|]/)
          .map((keyword) => keyword.trim())
          .filter(Boolean),
      };
    });

    if (!clinicsFromRows.length) throw new Error("Spreadsheet belum berisi baris data klinik.");
    return clinicsFromRows;
  }

  async function loadClinics() {
    const { spreadsheetId, gid } = window.ORISKIN_SHEET || {};
    if (!spreadsheetId || !gid) {
      throw new Error("Konfigurasi Google Spreadsheet belum lengkap di clinics.js.");
    }
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Spreadsheet belum dapat dibaca publik. Publikasikan tab sebagai CSV atau aktifkan akses viewer.");
      }
      throw new Error(`Google Spreadsheet gagal dimuat (HTTP ${response.status}).`);
    }
    clinics = clinicsFromCsv(await response.text());
  }

  function distanceKm(from, to) {
    const radians = (degrees) => (degrees * Math.PI) / 180;
    const [lat1, lon1] = from.map(radians);
    const [lat2, lon2] = to.map(radians);
    const deltaLat = lat2 - lat1;
    const deltaLon = lon2 - lon1;
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(distance) {
    return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} km`;
  }

  function formatRouteDistance(meters) {
    const kilometers = meters / 1000;
    return kilometers < 1
      ? `${Math.round(meters)} m`
      : `${kilometers.toFixed(1)} km`;
  }

  function formatTravelTime(distance) {
    const totalMinutes = Math.max(1, Math.round(distance / 0.8));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) return `~${minutes} menit`;
    if (!minutes) return `~${hours} jam`;
    return `~${hours} jam ${minutes} menit`;
  }

  function formatRouteDuration(seconds) {
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) return `${totalMinutes} menit`;
    if (!minutes) return `${hours} jam`;
    return `${hours} jam ${minutes} menit`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function logSearchEvent(query, searchType, resultCount, result) {
    const { adminWebAppUrl } = window.ORISKIN_SHEET || {};
    if (!adminWebAppUrl) {
      if (!searchLogWarningShown) {
        console.warn("Log pencarian belum dikonfigurasi: adminWebAppUrl tidak tersedia.");
        searchLogWarningShown = true;
      }
      return;
    }

    const logUrl = new URL(adminWebAppUrl);
    logUrl.searchParams.set("action", "logSearch");
    logUrl.searchParams.set("query", query.slice(0, 200));
    logUrl.searchParams.set("searchType", searchType);
    logUrl.searchParams.set("resultCount", String(resultCount));
    logUrl.searchParams.set("result", result);
    const request = new Image();
    request.src = logUrl.toString();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
  }

  function getMapsUrl(clinic) {
    return clinic.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [clinic.name, clinic.address, clinic.city].filter(Boolean).join(", "),
    )}`;
  }

  function getStatusLabel(status) {
    return {
      ya: "Berjalan",
      tidak: "Tidak ikut program",
      hold: "Di hold untuk program",
      stop: "Berhenti",
    }[status];
  }

  function clearRoute() {
    routeRequestSequence += 1;
    if (routeRequestController) {
      routeRequestController.abort();
      routeRequestController = null;
    }
    if (routeLine) {
      routeLine.remove();
      routeLine = null;
    }
  }

  function getRoutePopupContent(clinic, message) {
    return `
      <div class="clinic-route-popup">
        <strong>${escapeHtml(clinic.name)}</strong>
        <span class="clinic-route-status">${getStatusLabel(clinic.status)}</span>
        <p>${message}</p>
      </div>`;
  }

  function openClinicPopup(clinic, message) {
    L.popup({ offset: [0, -12] })
      .setLatLng(clinic.coordinates)
      .setContent(getRoutePopupContent(clinic, message))
      .openOn(map);
  }

  function animateRoute(line) {
    const path = line.getElement();
    if (!path) return Promise.resolve();
    const length = path.getTotalLength();
    if (!length) return Promise.resolve();
    path.style.transition = "none";
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.getBoundingClientRect();
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        path.style.transition = "stroke-dashoffset 500ms ease-out";
        path.style.strokeDashoffset = "0";
        window.setTimeout(resolve, 500);
      });
    });
  }

  function getGoogleDirectionsUrl(origin, destination) {
    const formatCoordinates = (coordinates) =>
      `${coordinates[0]},${coordinates[1]}`;
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", formatCoordinates(origin));
    url.searchParams.set("destination", formatCoordinates(destination));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  }

  async function showClinicRoute(clinic) {
    clearRoute();
    const requestSequence = routeRequestSequence;
    map.closePopup();
    if (!routeOrigin) {
      openClinicPopup(
        clinic,
        "Cari lokasi terlebih dahulu untuk melihat estimasi jarak dan waktu tempuh.",
      );
      return;
    }

    const controller = new AbortController();
    routeRequestController = controller;
    const routeUrl = new URL(
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${routeOrigin.coordinates[1]},${routeOrigin.coordinates[0]};${clinic.coordinates[1]},${clinic.coordinates[0]}`,
    );
    routeUrl.searchParams.set("overview", "full");
    routeUrl.searchParams.set("geometries", "geojson");
    routeUrl.searchParams.set("steps", "false");

    try {
      const response = await fetch(routeUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`layanan rute merespons HTTP ${response.status}`);
      const result = await response.json();
      const route = result.routes?.[0];
      if (
        result.code !== "Ok" ||
        !route ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration) ||
        !Array.isArray(route.geometry?.coordinates) ||
        route.geometry.coordinates.length < 2
      ) {
        throw new Error("rute jalan tidak ditemukan");
      }
      if (requestSequence !== routeRequestSequence) return;

      const routeCoordinates = route.geometry.coordinates.map(([longitude, latitude]) => [
        latitude,
        longitude,
      ]);
      routeLine = L.polyline(routeCoordinates, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      map.fitBounds(routeLine.getBounds(), {
        padding: [48, 48],
        maxZoom: 14,
        animate: false,
      });
      const displayedRoute = routeLine;
      await animateRoute(displayedRoute);
      if (requestSequence !== routeRequestSequence) return;

      openClinicPopup(
        clinic,
        `<span class="clinic-route-metric">${formatRouteDistance(route.distance)}</span> jarak tempuh<br><span class="clinic-route-metric">~${formatRouteDuration(route.duration)}</span> estimasi berkendara`,
      );
    } catch (error) {
      if (error.name === "AbortError" || requestSequence !== routeRequestSequence) return;
      console.error("Rute klinik gagal dimuat:", error);
      openClinicPopup(
        clinic,
        `Estimasi rute tidak tersedia saat ini. <a href="${escapeHtml(
          getGoogleDirectionsUrl(routeOrigin.coordinates, clinic.coordinates),
        )}" target="_blank" rel="noopener noreferrer">Buka petunjuk arah di Google Maps</a>.`,
      );
    } finally {
      if (requestSequence === routeRequestSequence) {
        routeRequestController = null;
      }
    }
  }

  function populateCityFilter() {
    const cities = [...new Set(clinics.map((clinic) => clinic.city))]
      .sort((first, second) => first.localeCompare(second, "id"));
    cityFilter.replaceChildren(new Option("Semua kota", ""));
    cities.forEach((city) => cityFilter.add(new Option(city, city)));
  }

  function createMarker(clinic, index) {
    const markerIcon = L.divIcon({
      className: "clinic-marker-wrap",
      html: `<span class="clinic-marker clinic-marker-${clinic.status}">${index === 0 ? "★" : index + 1}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const marker = L.marker(clinic.coordinates, { icon: markerIcon });
    marker.on("click", () => showClinicRoute(clinic));
    return marker;
  }

  function render() {
    clearRoute();
    const candidates = clinics
      .map((clinic) => ({
        ...clinic,
        distance: distanceKm(currentCenter, clinic.coordinates),
      }))
      .filter((clinic) => !cityFilter.value || clinic.city === cityFilter.value);

    if (radiusMode) {
      const withinRadius = candidates.filter((clinic) => clinic.distance <= 100);
      nearestFallbackMode = allowNearestFallback && withinRadius.length === 0;
      visibleClinics = (nearestFallbackMode ? candidates : withinRadius)
        .sort((first, second) => first.distance - second.distance)
        .slice(0, nearestFallbackMode ? 3 : undefined);
      document.querySelector("#result-radius").textContent = nearestFallbackMode
        ? "klinik terdekat · jarak garis lurus"
        : "dalam radius 100 km dari";
    } else {
      nearestFallbackMode = false;
      visibleClinics = candidates.sort(
        (first, second) =>
          first.city.localeCompare(second.city, "id") ||
          first.name.localeCompare(second.name, "id"),
      );
      document.querySelector("#result-radius").textContent = "di seluruh lokasi";
    }

    document.querySelector("#result-count").textContent =
      `${visibleClinics.length} cabang`;
    document.querySelector("#map-result-count").textContent =
      `${visibleClinics.length} cabang ditemukan`;
    clinicList.innerHTML = "";
    markerLayer.clearLayers();
    markers.clear();

    visibleClinics.forEach((clinic, index) => {
      const marker = createMarker(clinic, index);
      markers.set(clinic.id, marker);
      markerLayer.addLayer(marker);

      const card = document.createElement("article");
      card.className = "clinic-card";
      card.tabIndex = 0;
      card.setAttribute(
        "aria-label",
        `${clinic.name}, ${getStatusLabel(clinic.status)}${radiusMode ? `, ${formatDistance(clinic.distance)}` : ""}`,
      );
      const distanceMarkup = radiusMode
        ? `<div class="distance" title="Jarak garis lurus, bukan rute jalan">${formatDistance(clinic.distance)}<small>${formatTravelTime(clinic.distance)}</small></div>`
        : "";
      card.innerHTML = `
        <div class="card-heading">
          <span class="rank-badge ${radiusMode && index === 0 ? "rank-featured" : ""}">${radiusMode && index === 0 ? "★" : index + 1}</span>
          <div class="clinic-title">
            <strong>${escapeHtml(clinic.name)}</strong>
            ${radiusMode && index === 0 ? '<span class="nearest-badge">⭐ Terdekat</span>' : ""}
            <span class="status-badge status-${clinic.status}">${getStatusLabel(clinic.status)}</span>
            <span>${escapeHtml(clinic.city)}</span>
          </div>
          ${distanceMarkup}
        </div>
        <p class="clinic-detail"><span aria-hidden="true">♧</span>${escapeHtml(clinic.address)}</p>
        <p class="clinic-detail"><span aria-hidden="true">◷</span>${escapeHtml(clinic.hours || "Jam operasional belum tersedia")}</p>
        <p class="clinic-detail"><span aria-hidden="true">♧</span>${escapeHtml(clinic.phone || "Nomor telepon belum tersedia")}</p>
        <div class="card-actions${clinic.whatsapp ? " has-whatsapp" : ""}">
          <a class="maps-button" href="${escapeHtml(getMapsUrl(clinic))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span> Google Maps</a>
          ${clinic.whatsapp ? `<a class="whatsapp-button" href="https://wa.me/${encodeURIComponent(clinic.whatsapp)}" target="_blank" rel="noopener noreferrer" aria-label="Hubungi ${escapeHtml(clinic.name)} melalui WhatsApp">◔ WA</a>` : ""}
          <button class="copy-button" type="button" data-copy="${escapeHtml(clinic.address)}">▢ Salin</button>
          ${clinic.whatsapp ? '<button class="copy-button copy-whatsapp-button" type="button">▢ Salin WA</button>' : ""}
        </div>`;

      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button")) return;
        focusClinic(clinic);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusClinic(clinic);
        }
      });
      card.querySelector(".copy-button").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(clinic.address);
          showToast("Alamat klinik berhasil disalin");
        } catch (error) {
          showToast("Tidak dapat menyalin alamat. Silakan salin secara manual.");
        }
      });
      const copyWhatsappButton = card.querySelector(".copy-whatsapp-button");
      if (copyWhatsappButton) {
        copyWhatsappButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(clinic.whatsapp);
            showToast("Nomor WhatsApp berhasil disalin");
          } catch (error) {
            showToast("Tidak dapat menyalin nomor WhatsApp. Silakan salin secara manual.");
          }
        });
      }
      clinicList.append(card);
    });

    if (!visibleClinics.length) {
      clinicList.innerHTML =
        `<div class="empty-results">${radiusMode && cityFilter.value ? "Tidak ada klinik dari kota ini di sekitar lokasi pencarian." : radiusMode ? "Belum ada klinik dalam radius 100 km." : "Tidak ada klinik untuk filter kota ini."}</div>`;
    } else if (nearestFallbackMode) {
      map.fitBounds(
        L.latLngBounds([currentCenter, ...visibleClinics.map((clinic) => clinic.coordinates)]),
        { padding: [32, 32], maxZoom: 6 },
      );
    } else if (!radiusMode) {
      map.fitBounds(markerLayer.getBounds(), { padding: [32, 32], maxZoom: 6 });
    }
  }

  function focusClinic(clinic) {
    map.setView(clinic.coordinates, 14, { animate: true });
    const marker = markers.get(clinic.id);
    if (marker) showClinicRoute(clinic);
  }

  function focusSearchLocation(center, zoom = 12, fitResults = false) {
    window.requestAnimationFrame(() => {
      map.stop();
      map.invalidateSize({ pan: false });
      if (fitResults && visibleClinics.length) {
        map.fitBounds(
          L.latLngBounds([center, ...visibleClinics.map((clinic) => clinic.coordinates)]),
          { padding: [32, 32], maxZoom: 6 },
        );
      } else {
        map.flyTo(center, zoom, { animate: true, duration: 1.2 });
      }
    });
  }

  function setLocation(center, label, zoom = 12) {
    clearRoute();
    currentCenter = center;
    routeOrigin = null;
    radiusMode = true;
    allowNearestFallback = false;
    if (searchLocationMarker) {
      searchLocationMarker.remove();
      searchLocationMarker = null;
    }
    document.querySelector("#active-location").textContent = label;
    document.querySelector("#result-radius").textContent = "dalam radius 100 km dari";
    render();
    focusSearchLocation(center, zoom);
  }

  function showAllLocations() {
    clearRoute();
    searchSequence += 1;
    radiusMode = false;
    routeOrigin = null;
    allowNearestFallback = false;
    nearestFallbackMode = false;
    currentCenter = defaultCenter;
    searchInput.value = "";
    searchButton.disabled = false;
    if (searchLocationMarker) {
      searchLocationMarker.remove();
      searchLocationMarker = null;
    }
    document.querySelector("#active-location").textContent = "Seluruh lokasi";
    document.querySelector("#result-radius").textContent = "di seluruh lokasi";
    render();
  }

  function renderLogs(rows) {
    logsList.replaceChildren();
    const headers = rows[0].map((header) => normalize(header).replace(/[^a-z0-9]/g, ""));
    const column = (...names) => headers.findIndex((header) => names.includes(header));
    const columns = {
      timestamp: column("timestamp", "waktu", "tanggal"),
      announcement: column("announcement", "pengumuman", "pesan", "log"),
      admin: column("admin", "author", "penulis", "administrator"),
    };
    if (columns.announcement === -1) {
      throw new Error('Kolom "Pengumuman" tidak ditemukan di tab log.');
    }

    const entries = rows
      .slice(1)
      .filter((values) => values[columns.announcement]?.trim())
      .reverse()
      .slice(0, 100);
    entries.forEach((values) => {
      const entry = document.createElement("article");
      entry.className = "announcement-entry";
      const message = document.createElement("p");
      message.className = "announcement-text";
      message.textContent = values[columns.announcement];
      entry.append(message);

      const metadata = [
        columns.timestamp === -1 ? "" : values[columns.timestamp] || "",
        columns.admin === -1 ? "" : values[columns.admin] || "",
      ].filter(Boolean);
      if (metadata.length) {
        const meta = document.createElement("small");
        meta.className = "announcement-meta";
        meta.textContent = metadata.join(" · ");
        entry.append(meta);
      }
      logsList.append(entry);
    });
    logsStatus.textContent = entries.length
      ? `Menampilkan ${entries.length} pengumuman terbaru.`
      : "Belum ada pengumuman.";
  }

  async function loadLogs() {
    const { spreadsheetId, logGid } = window.ORISKIN_SHEET || {};
    logsList.replaceChildren();
    if (!logGid) {
      logsStatus.textContent =
        "Tab pengumuman belum dikonfigurasi. Buat sheet Log Perubahan dengan kolom Waktu, Pengumuman, dan Admin, lalu isi logGid di clinics.js.";
      return;
    }

    logsStatus.textContent = "Memuat pengumuman...";
    try {
      const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(logGid)}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Tab Log Perubahan belum dipublikasikan atau belum dapat dibaca."
            : `Pengumuman gagal dimuat (HTTP ${response.status}).`,
        );
      }
      renderLogs(parseCsv(await response.text()));
    } catch (error) {
      logsStatus.textContent =
        error instanceof TypeError
          ? "Tidak dapat mengakses tab pengumuman. Pastikan tab dipublikasikan sebagai CSV dan periksa koneksi."
          : error.message;
    }
  }

  function getRecents() {
    try {
      const saved = JSON.parse(localStorage.getItem(recentKey) || "[]");
      return Array.isArray(saved) ? saved.filter((item) => typeof item === "string").slice(0, 5) : [];
    } catch (error) {
      return [];
    }
  }

  function renderRecents() {
    const container = document.querySelector("#recent-searches");
    const recents = getRecents();
    container.innerHTML = recents.length
      ? recents
          .map(
            (item) =>
              `<button class="recent-chip" type="button" data-query="${escapeHtml(item)}"><span aria-hidden="true">◷</span>${escapeHtml(item)}</button>`,
          )
          .join("")
      : '<span class="recent-empty">Belum ada pencarian</span>';
    container.querySelectorAll(".recent-chip").forEach((button) => {
      button.addEventListener("click", () => searchLocation(button.dataset.query));
    });
  }

  function saveRecent(query) {
    const recents = getRecents().filter((item) => normalize(item) !== normalize(query));
    try {
      localStorage.setItem(recentKey, JSON.stringify([query, ...recents].slice(0, 5)));
    } catch (error) {
      showToast("Pencarian dapat digunakan, tetapi tidak bisa disimpan di perangkat ini.");
    }
    renderRecents();
  }

  async function geocodeLocation(query) {
    const cacheKey = normalize(query);
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

    const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    lastGeocodeAt = Date.now();
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.search = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: "1",
        countrycodes: "id",
        "accept-language": "id",
      });
      const response = await fetch(url, {
        headers: { "Accept-Language": "id" },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new Error("Layanan pencarian lokasi sedang sibuk. Tunggu sebentar, lalu coba lagi.");
      }
      if (!response.ok) {
        throw new Error(`Pencarian lokasi gagal (HTTP ${response.status}).`);
      }

      const results = await response.json();
      const result = results[0];
      if (!result) return null;

      const location = {
        coordinates: [Number(result.lat), Number(result.lon)],
        label: result.name || result.display_name.split(",")[0] || query,
      };
      if (location.coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
        throw new Error("Koordinat lokasi pencarian tidak valid.");
      }
      geocodeCache.set(cacheKey, location);
      return location;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Pencarian lokasi melewati batas waktu. Silakan coba lagi.");
      }
      if (error instanceof TypeError) {
        throw new Error("Tidak dapat mengakses pencarian lokasi. Periksa koneksi internet.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function searchLocation(query) {
    const value = query.trim();
    if (!value) {
      showToast("Masukkan nama klinik, daerah, mall, atau landmark.");
      return;
    }
    const requestId = ++searchSequence;
    const target = normalize(value);
    const matches = clinics.filter((clinic) => {
      const searchable = [
        clinic.name,
        clinic.city,
        clinic.address,
        ...(clinic.keywords || []),
      ];
      return searchable.some((part) => normalize(part).includes(target) || target.includes(normalize(part)));
    });

    if (!matches.length) {
      searchButton.disabled = true;
      searchButton.textContent = "...";
      try {
        const location = await geocodeLocation(value);
        if (requestId !== searchSequence) return;
        if (!location) {
          logSearchEvent(value, "Lokasi", 0, "Lokasi tidak ditemukan");
          showToast(`Lokasi "${value}" tidak ditemukan. Coba nama kota atau daerah lain.`);
          return;
        }

        saveRecent(value);
        searchInput.value = value;
        currentCenter = location.coordinates;
        routeOrigin = { coordinates: location.coordinates, label: location.label };
        radiusMode = true;
        allowNearestFallback = true;
        document.querySelector("#active-location").textContent = location.label;
        document.querySelector("#result-radius").textContent = "dalam radius 100 km dari";

        if (searchLocationMarker) searchLocationMarker.remove();
        clearRoute();
        searchLocationMarker = L.circleMarker(location.coordinates, {
          radius: 9,
          color: "#fff",
          weight: 3,
          fillColor: "#6f59c9",
          fillOpacity: 1,
        })
          .bindPopup(`<strong>Lokasi pencarian</strong><br>${escapeHtml(location.label)}`)
          .addTo(map);

        render();
        logSearchEvent(
          value,
          "Lokasi",
          visibleClinics.length,
          nearestFallbackMode ? "Menampilkan klinik terdekat" : "Klinik sekitar ditemukan",
        );
        focusSearchLocation(
          location.coordinates,
          12,
          nearestFallbackMode && visibleClinics.length > 0,
        );
        showToast(
          nearestFallbackMode
            ? `Tidak ada klinik dalam 100 km. Menampilkan klinik terdekat dari ${location.label}.`
            : `Menampilkan klinik dalam radius 100 km dari ${location.label}.`,
        );
      } catch (error) {
        if (requestId === searchSequence) {
          logSearchEvent(value, "Lokasi", 0, "Gagal mencari lokasi");
          showToast(error.message);
        }
      } finally {
        if (requestId === searchSequence) {
          searchButton.disabled = false;
          searchButton.textContent = "⌕";
        }
      }
      return;
    }

    saveRecent(value);
    searchInput.value = value;
    if (searchLocationMarker) {
      searchLocationMarker.remove();
      searchLocationMarker = null;
    }
    setLocation(matches[0].coordinates, value, 12);
    routeOrigin = { coordinates: matches[0].coordinates, label: value };
    logSearchEvent(value, "Klinik/kata kunci", visibleClinics.length, "Lokasi ditemukan");
    showToast(`Lokasi "${value}" ditemukan. Menampilkan klinik dalam radius 100 km.`);
  }

  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchLocation(searchInput.value);
  });

  searchInput.addEventListener("input", () => {
    if (!searchInput.value.trim() && radiusMode) showAllLocations();
    else if (searchButton.disabled) {
      searchSequence += 1;
      searchButton.disabled = false;
      searchButton.textContent = "⌕";
    }
  });

  cityFilter.addEventListener("change", render);

  document.querySelector("#logs-button").addEventListener("click", () => {
    logsDialog.showModal();
    loadLogs();
  });
  document.querySelector("#logs-close").addEventListener("click", () => logsDialog.close());
  document.querySelector("#admin-login-button").addEventListener("click", () => {
    const { adminWebAppUrl } = window.ORISKIN_SHEET || {};
    if (!adminWebAppUrl) {
      logsStatus.textContent =
        "Halaman administrator belum dikonfigurasi. Isi adminWebAppUrl di clinics.js setelah Apps Script Web App di-deploy.";
      return;
    }
    window.open(adminWebAppUrl, "_blank", "noopener,noreferrer");
  });
  document.querySelector("#change-request-button").addEventListener("click", () => {
    const { adminWebAppUrl } = window.ORISKIN_SHEET || {};
    if (!adminWebAppUrl) {
      logsStatus.textContent =
        "Formulir pengajuan belum dikonfigurasi. Isi adminWebAppUrl di clinics.js setelah Apps Script Web App di-deploy.";
      return;
    }
    const requestUrl = new URL(adminWebAppUrl);
    requestUrl.searchParams.set("page", "request");
    window.open(requestUrl.toString(), "_blank", "noopener,noreferrer");
  });
  logsDialog.addEventListener("click", (event) => {
    if (event.target === logsDialog) logsDialog.close();
  });

  document.querySelector("#locate-button").addEventListener("click", () => {
    if (!navigator.geolocation) {
    logSearchEvent("Lokasi Saya", "GPS", 0, "Lokasi tidak didukung");
    showToast("Browser ini tidak mendukung fitur lokasi.");
    return;
    }
    const button = document.querySelector("#locate-button");
    button.disabled = true;
    button.textContent = "Mencari lokasi...";
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const center = [coords.latitude, coords.longitude];
        setLocation(center, "Lokasi Saya", 12);
        logSearchEvent("Lokasi Saya", "GPS", visibleClinics.length, "Lokasi berhasil digunakan");
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">➤</span> Gunakan Lokasi Saya';
      },
      (error) => {
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">➤</span> Gunakan Lokasi Saya';
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Izin lokasi ditolak. Aktifkan izin lokasi di browser."
            : "Lokasi tidak berhasil didapatkan. Coba lagi.";
        logSearchEvent(
          "Lokasi Saya",
          "GPS",
          0,
          error.code === error.PERMISSION_DENIED
            ? "Izin lokasi ditolak"
            : "Lokasi gagal didapatkan",
        );
        showToast(message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  document.querySelector("#share-button").addEventListener("click", async () => {
    const shareData = { title: "Oriskin Branch Locator", url: window.location.href };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Tautan locator berhasil disalin");
      }
    } catch (error) {
      if (error.name !== "AbortError") showToast("Tautan tidak dapat dibagikan.");
    }
  });

  document.querySelector("#theme-toggle").addEventListener("click", (event) => {
    const dark = document.body.classList.toggle("dark-theme");
    event.currentTarget.textContent = dark ? "☀" : "☾";
    event.currentTarget.setAttribute(
      "aria-label",
      dark ? "Aktifkan mode terang" : "Aktifkan mode gelap",
    );
    try {
      localStorage.setItem(themeKey, dark ? "dark" : "light");
    } catch (error) {
      showToast("Preferensi tema tidak dapat disimpan.");
    }
  });

  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem(themeKey) || "light";
  } catch (error) {
    showToast("Preferensi tema tidak dapat dibaca.");
  }
  if (savedTheme === "dark") {
    document.body.classList.add("dark-theme");
    document.querySelector("#theme-toggle").textContent = "☀";
  }

  renderRecents();
  loadClinics()
    .then(() => {
      document.querySelector("#clinic-total").textContent = clinics.length;
      populateCityFilter();
      dataStatus.textContent = "";
      showAllLocations();
    })
    .catch((error) => {
      const message =
        error instanceof TypeError
          ? "Tidak dapat mengakses Google Spreadsheet. Publikasikan tab sebagai CSV dan periksa koneksi internet."
          : error.message;
      dataStatus.textContent = `Data klinik gagal dimuat: ${message}`;
      showToast("Tidak dapat memuat data klinik dari Google Spreadsheet.");
      document.querySelector("#result-count").textContent = "0 cabang";
      document.querySelector("#map-result-count").textContent = "0 cabang ditemukan";
    });
})();
