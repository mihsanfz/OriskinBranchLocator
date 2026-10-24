const ANNOUNCEMENT_LOG_SHEET_NAME = "Log Perubahan";
const ANNOUNCEMENT_LOG_HEADERS = ["Waktu", "Pengumuman", "Admin"];
const ADMIN_SESSION_TTL_SECONDS = 3600;
const ADMIN_MAX_ANNOUNCEMENT_LENGTH = 1000;
const CHANGE_REQUEST_SHEET_NAME = "Pengajuan Perubahan";
const CHANGE_REQUEST_HEADERS = [
  "Waktu Pengajuan",
  "Nama Pengaju",
  "Kontak",
  "Klinik",
  "Rincian Perubahan",
  "Status",
];
const CHANGE_REQUEST_LIMIT = 5;
const CHANGE_REQUEST_WINDOW_SECONDS = 3600;

function setupAnnouncementLog() {
  const activeUser = Session.getActiveUser().getEmail();
  const scriptOwner = Session.getEffectiveUser().getEmail();
  if (!activeUser || activeUser !== scriptOwner) {
    throw new Error("Hanya pemilik spreadsheet yang boleh menjalankan setup.");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty(
    "SPREADSHEET_ID",
    spreadsheet.getId(),
  );
  let sheet = spreadsheet.getSheetByName(ANNOUNCEMENT_LOG_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(ANNOUNCEMENT_LOG_SHEET_NAME);

  sheet
    .getRange(1, 1, 1, ANNOUNCEMENT_LOG_HEADERS.length)
    .setValues([ANNOUNCEMENT_LOG_HEADERS]);
  sheet.setFrozenRows(1);
  let requestSheet = spreadsheet.getSheetByName(CHANGE_REQUEST_SHEET_NAME);
  if (!requestSheet) requestSheet = spreadsheet.insertSheet(CHANGE_REQUEST_SHEET_NAME);
  requestSheet
    .getRange(1, 1, 1, CHANGE_REQUEST_HEADERS.length)
    .setValues([CHANGE_REQUEST_HEADERS]);
  requestSheet.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    `Sheet "${ANNOUNCEMENT_LOG_SHEET_NAME}" dan "${CHANGE_REQUEST_SHEET_NAME}" siap.\nCatat gid ${sheet.getSheetId()} di clinics.js sebagai logGid.`,
  );
}

function doGet(event) {
  if (event && event.parameter && event.parameter.page === "request") {
    return HtmlService.createHtmlOutputFromFile("request").setTitle(
      "Ajukan Perubahan Klinik",
    );
  }
  return HtmlService.createHtmlOutputFromFile("admin").setTitle(
    "Administrator — Log Perubahan Klinik",
  );
}

function submitChangeRequest(name, contact, clinic, details) {
  const cache = CacheService.getScriptCache();
  const userKey = Session.getTemporaryActiveUserKey() || "anonymous";
  const attemptKey = `change-request-attempts:${userKey}`;
  const fields = {
    name: String(name || "").trim(),
    contact: String(contact || "").trim(),
    clinic: String(clinic || "").trim(),
    details: String(details || "").trim(),
  };
  if (!fields.name || !fields.clinic || !fields.details) {
    throw new Error("Nama, nama klinik, dan rincian perubahan wajib diisi.");
  }
  if (fields.name.length > 100 || fields.contact.length > 100 ||
      fields.clinic.length > 150 || fields.details.length > 1500) {
    throw new Error("Ada isian yang melebihi batas karakter.");
  }

  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Pemilik spreadsheet perlu menjalankan setupAnnouncementLog() terlebih dahulu.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(CHANGE_REQUEST_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${CHANGE_REQUEST_SHEET_NAME}" belum dibuat. Hubungi administrator.`);
  }

  const safeValue = (value) => (/^[=+\-@]/.test(value) ? `'${value}` : value);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const attempts = Number(cache.get(attemptKey) || "0");
    if (attempts >= CHANGE_REQUEST_LIMIT) {
      throw new Error("Batas pengajuan tercapai. Silakan coba lagi satu jam kemudian.");
    }
    sheet
      .getRange(sheet.getLastRow() + 1, 1, 1, CHANGE_REQUEST_HEADERS.length)
      .setValues([[
        new Date(),
        safeValue(fields.name),
        safeValue(fields.contact),
        safeValue(fields.clinic),
        safeValue(fields.details),
        "Menunggu",
      ]]);
    cache.put(attemptKey, String(attempts + 1), CHANGE_REQUEST_WINDOW_SECONDS);
  } finally {
    lock.releaseLock();
  }

  return { saved: true };
}

function loginAdmin(username, password) {
  const properties = PropertiesService.getScriptProperties();
  const adminUsername = properties.getProperty("ADMIN_USERNAME");
  const adminPassword = properties.getProperty("ADMIN_PASSWORD");
  if (!adminUsername || !adminPassword) {
    throw new Error("Atur ADMIN_USERNAME dan ADMIN_PASSWORD di Script Properties.");
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = `admin-login-attempts:${Session.getTemporaryActiveUserKey()}`;
  const attempts = Number(cache.get(attemptKey) || "0");
  if (attempts >= 5) {
    throw new Error("Terlalu banyak percobaan login. Coba lagi setelah 15 menit.");
  }
  if (username !== adminUsername || password !== adminPassword) {
    cache.put(attemptKey, String(attempts + 1), 900);
    throw new Error("Username atau password salah.");
  }

  cache.remove(attemptKey);
  const token = `${Utilities.getUuid()}${Utilities.getUuid()}`;
  cache.put(`admin-session:${token}`, adminUsername, ADMIN_SESSION_TTL_SECONDS);
  return { token, username: adminUsername };
}

function addAnnouncement(token, message) {
  const sessionToken = String(token || "");
  if (!/^[0-9a-f-]{72}$/i.test(sessionToken)) {
    throw new Error("Sesi admin tidak valid. Silakan login kembali.");
  }
  const cache = CacheService.getScriptCache();
  const username = cache.get(`admin-session:${sessionToken}`);
  if (!username) throw new Error("Sesi admin berakhir. Silakan login kembali.");

  const announcement = String(message || "").trim();
  if (!announcement) throw new Error("Isi pengumuman terlebih dahulu.");
  if (announcement.length > ADMIN_MAX_ANNOUNCEMENT_LENGTH) {
    throw new Error(`Pengumuman maksimal ${ADMIN_MAX_ANNOUNCEMENT_LENGTH} karakter.`);
  }

  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Jalankan setupAnnouncementLog() terlebih dahulu.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(ANNOUNCEMENT_LOG_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${ANNOUNCEMENT_LOG_SHEET_NAME}" belum dibuat.`);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const safeAnnouncement = /^[=+\-@]/.test(announcement)
      ? `'${announcement}`
      : announcement;
    sheet
      .getRange(sheet.getLastRow() + 1, 1, 1, ANNOUNCEMENT_LOG_HEADERS.length)
      .setValues([[new Date(), safeAnnouncement, username]]);
  } finally {
    lock.releaseLock();
  }

  return { saved: true };
}
