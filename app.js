(() => {
  let clinics = [];
  const defaultCenter = [-6.2417, 106.6268];
  const recentKey = "oriskin-locator-recent";
  const themeKey = "oriskin-locator-theme";
  const map = L.map("map", { zoomControl: false }).setView([-2.5, 118], 5);
  const markers = new Map();
  const markerLayer = L.featureGroup().addTo(map);
  const clinicList = document.querySelector("#clinic-list");
  const searchInput = document.querySelector("#search-input");
  const toast = document.querySelector("#toast");
  const dataStatus = document.querySelector("#data-status");
  let currentCenter = defaultCenter;
  let visibleClinics = clinics.slice();
  let toastTimer;

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
      const mapsUrl = cell("mapsUrl");
      const latitudeValue = cell("latitude");
      const longitudeValue = cell("longitude");
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);

      if (!id || !name || !city || !address) {
        throw new Error(`ID, nama, kota, dan alamat wajib diisi (baris ${rowNumber}).`);
      }
      if (ids.has(id)) throw new Error(`ID klinik "${id}" duplikat (baris ${rowNumber}).`);
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

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
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

  function createMarker(clinic, index) {
    const markerIcon = L.divIcon({
      className: "clinic-marker-wrap",
      html: `<span class="clinic-marker">${index === 0 ? "★" : index + 1}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    return L.marker(clinic.coordinates, { icon: markerIcon }).bindPopup(
      `<strong>${escapeHtml(clinic.name)}</strong><br>${escapeHtml(clinic.address)}`,
    );
  }

  function render() {
    visibleClinics = clinics
      .map((clinic) => ({
        ...clinic,
        distance: distanceKm(currentCenter, clinic.coordinates),
      }))
      .filter((clinic) => clinic.distance <= 100)
      .sort((first, second) => first.distance - second.distance);

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
      card.setAttribute("aria-label", `${clinic.name}, ${formatDistance(clinic.distance)}`);
      card.innerHTML = `
        <div class="card-heading">
          <span class="rank-badge ${index === 0 ? "rank-featured" : ""}">${index === 0 ? "★" : index + 1}</span>
          <div class="clinic-title">
            <strong>${escapeHtml(clinic.name)}</strong>
            ${index === 0 ? '<span class="nearest-badge">⭐ Terdekat</span>' : ""}
            <span>${escapeHtml(clinic.city)}</span>
          </div>
          <div class="distance">${formatDistance(clinic.distance)}<small>~${Math.max(1, Math.round(clinic.distance / 0.8))} menit</small></div>
        </div>
        <p class="clinic-detail"><span aria-hidden="true">♧</span>${escapeHtml(clinic.address)}</p>
        <p class="clinic-detail"><span aria-hidden="true">◷</span>${clinic.hours ? `${escapeHtml(clinic.hours)} <span class="open-badge"><i></i> Buka</span>` : "Jam operasional belum tersedia"}</p>
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
        '<div class="empty-results">Belum ada klinik dalam radius 100 km. Coba cari lokasi lain.</div>';
    }
  }

  function focusClinic(clinic) {
    map.setView(clinic.coordinates, 14, { animate: true });
    const marker = markers.get(clinic.id);
    if (marker) marker.openPopup();
  }

  function setLocation(center, label, zoom = 12) {
    currentCenter = center;
    document.querySelector("#active-location").textContent = label;
    document.querySelector("#result-radius").textContent = "dalam radius 100 km dari";
    map.setView(center, zoom, { animate: true });
    render();
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

  function searchLocation(query) {
    const value = query.trim();
    if (!value) {
      showToast("Masukkan nama klinik, daerah, mall, atau landmark.");
      return;
    }
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
      showToast("Lokasi tidak ditemukan di data klinik. Periksa kata kunci di Google Spreadsheet.");
      return;
    }

    saveRecent(value);
    searchInput.value = value;
    setLocation(matches[0].coordinates, value, 12);
    showToast(`Lokasi "${value}" ditemukan. Menampilkan klinik dalam radius 100 km.`);
  }

  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchLocation(searchInput.value);
  });

  document.querySelector("#locate-button").addEventListener("click", () => {
    if (!navigator.geolocation) {
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
      dataStatus.textContent = "";
      render();
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
