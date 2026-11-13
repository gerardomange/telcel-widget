// Variables used by Scriptable.
// icon-color: brown; icon-glyph: signal;

// Telcel Widget · por Attego
// Muestra tus datos disponibles de Telcel en la pantalla de inicio del iPhone.
// Guía y generador visual: https://gerardomange.github.io/telcel-widget/
// Licencia MIT. La conexión con Telcel está basada en mobile-data-tracker
// de Gabriel Soto (https://github.com/gabri3l0/mobile-data-tracker).

const RUN_AT = new Date();
const WIDGET_VERSION = "1.0.0";

// Personaliza aquí, o genera este bloque en la página del generador.
// Tu número y contraseña NO van aquí: se piden al ejecutar y se guardan en el Keychain.
// <SETTINGS>
const SETTINGS = {
  backgroundHex: "0F0F11", // Fondo. Attego: obsidiana.
  textPrimaryHex: "E6E7E8", // Cifra y nombre del plan. Attego: hueso.
  textSecondaryHex: "99999B", // Detalles y pista de la gráfica.
  accentHex: "9D7D5D", // Gráfica y rótulo TELCEL. Attego: bronce.
  chartStyle: "bar", // bar, arc (semicírculo) o none.
  barCorners: "square", // square (recto, Attego) o round.
  font: "helvetica", // helvetica (Attego) o system (San Francisco).
  showPlanName: true, // false muestra solo el rótulo TELCEL.
  backgroundImageUrl: "", // Opcional: URL https de una imagen de fondo.
  backgroundOverlayOpacity: 0.55, // 0 a 1. Capa del color de fondo sobre la imagen.
  cacheMinutes: 30, // Minutos que se reutiliza la última lectura.
  retryMinutes: 15, // Espera después de un fallo.
  requestTimeoutSeconds: 20,
  debug: false, // Registro seguro en la consola de Scriptable.
  useSampleData: false, // true muestra datos de ejemplo sin consultar a Telcel.
  sampleState: "success", // success, stale, error, setup, update.
};
// </SETTINGS>

const SITE_URL = "https://gerardomange.github.io/telcel-widget/";
const VERSION_URL = SITE_URL + "version.json";
const VERSION_CACHE_FILE = "attego-telcel-widget-version-v1.json";
const KEYCHAIN_KEY = "attego-telcel-widget.credentials.v1";
const CACHE_FILE = "attego-telcel-widget-usage-v1.json";
const IMAGE_CACHE_FILE = "attego-telcel-widget-background-v1";
const CLIENT_AUTH = "YlhSd2MyVnlkbWxqWlhNNk55UTROM0ptUm5OM1pTUXlNVjg9";
const WEB_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CARRIER_NAME = "TELCEL";
const BAR_WIDTH = 112;
const BAR_HEIGHT = 6;
const SAMPLE_DATA = {
  plan_name: "Amigo Sin Límite 200", expiration_date: "2026-10-24", days_until: 5,
  last_updated: "2026-10-18T10:26:00", total_data: 7, total_unit: "GB", used_data: 5.4, used_unit: "GB",
  remaining_data: 1.6, remaining_unit: "GB", used_percentage: 77.14, remaining_percentage: 22.86,
};

// ---------- Apariencia ----------

function appearanceHex(value, fallback) {
  return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().replace(/^#/, "").toUpperCase() : fallback;
}

const COLORS = {
  get background() { return appearanceHex(SETTINGS.backgroundHex, "0F0F11"); },
  get text() { return appearanceHex(SETTINGS.textPrimaryHex, "E6E7E8"); },
  get muted() { return appearanceHex(SETTINGS.textSecondaryHex, "99999B"); },
  get accent() { return appearanceHex(SETTINGS.accentHex, "9D7D5D"); },
};

// Contraste WCAG entre dos colores hex.
function contrast(a, b) {
  const luminance = hex => {
    const channel = index => {
      const value = parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// El rótulo va en el color de acento solo si se lee bien sobre el fondo (regla Attego: bronce sobre hueso no sirve para texto chico).
function labelColor() {
  return contrast(COLORS.accent, COLORS.background) >= 4.5 ? COLORS.accent : COLORS.text;
}

function chartStyle() {
  return ["bar", "arc", "none"].includes(SETTINGS.chartStyle) ? SETTINGS.chartStyle : "bar";
}

function overlayOpacity() {
  const value = Number(SETTINGS.backgroundOverlayOpacity);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.55;
}

function imageURL() {
  const url = typeof SETTINGS.backgroundImageUrl === "string" ? SETTINGS.backgroundImageUrl.trim() : "";
  return /^https:\/\/[^\s]+$/i.test(url) ? url : "";
}

// Pesos del sistema Attego: Medium para títulos, Bold solo para cifras, Roman para el resto.
function font(weight, size) {
  if (SETTINGS.font === "system") {
    return weight === "bold" ? Font.boldSystemFont(size)
      : weight === "medium" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  }
  const name = weight === "bold" ? "HelveticaNeue-Bold"
    : weight === "medium" ? "HelveticaNeue-Medium" : "HelveticaNeue";
  return new Font(name, size);
}

// ---------- Registro y errores ----------

function debugLog(message) {
  if (SETTINGS.debug) console.log(`[Telcel] ${message}`);
}

function diagnosticError(code) {
  const error = new Error("No se pudo consultar Telcel.");
  error.code = /^(configuration|usage_data|login_rejected|token_missing|(?:login|token|usage|logout|oidc_authorize|oidc_token)_(?:network|json|http_[1-5]\d{2})|oidc_(?:code|state|authorize_rejected|token_missing|token_rejected))$/.test(code) ? code : "unknown";
  return error;
}

// ---------- Aviso de nueva versión ----------

function generatorURL() {
  const appearance = {
    bg: COLORS.background, primary: COLORS.text, secondary: COLORS.muted, accent: COLORS.accent,
    chart: chartStyle(), corners: SETTINGS.barCorners === "round" ? "round" : "square",
    font: SETTINGS.font === "system" ? "system" : "helvetica",
    plan: String(SETTINGS.showPlanName !== false),
    image: imageURL(), overlay: String(overlayOpacity()),
  };
  // La apariencia viaja en el fragmento (#), que no se envía al servidor. Nunca incluye datos de la cuenta.
  const params = Object.entries(appearance)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `${SITE_URL}?update=1#${params}`;
}

function versionParts(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function newerVersion(latest, installed = WIDGET_VERSION) {
  const a = versionParts(latest), b = versionParts(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function checkForUpdate() {
  const now = Date.now();
  let files, path, cache = null;
  try {
    files = FileManager.local();
    path = files.joinPath(files.libraryDirectory(), VERSION_CACHE_FILE);
    if (files.fileExists(path)) {
      const saved = JSON.parse(files.readString(path));
      if (saved && (saved.latestVersion === null || versionParts(saved.latestVersion))
        && Number.isFinite(saved.checkedAt) && saved.checkedAt >= 0 && saved.checkedAt <= now
        && Number.isFinite(saved.nextCheckAt) && saved.nextCheckAt >= saved.checkedAt
        && saved.nextCheckAt <= saved.checkedAt + 86400000) cache = saved;
    }
  } catch { /* El aviso de versión es opcional. */ }
  if (cache && cache.nextCheckAt > now) return newerVersion(cache.latestVersion);
  let latestVersion = cache ? cache.latestVersion : null;
  let interval = 3600000;
  try {
    const request = new Request(VERSION_URL);
    request.timeoutInterval = 3;
    request.headers = { Accept: "application/json", "Cache-Control": "no-cache" };
    const body = await request.loadString();
    if (request.response.statusCode !== 200) throw new Error("Version unavailable");
    const metadata = JSON.parse(body);
    if (!metadata || !versionParts(metadata.version)) throw new Error("Invalid version");
    latestVersion = metadata.version;
    interval = 86400000;
  } catch { /* Conserva la última versión conocida y reintenta en una hora. */ }
  try {
    if (files && path) files.writeString(path, JSON.stringify({ latestVersion, checkedAt: now, nextCheckAt: now + interval }));
  } catch { /* Un fallo de caché no debe afectar al widget. */ }
  return newerVersion(latestVersion);
}

// ---------- Cuenta (Keychain) ----------

function cacheLocation() {
  const files = FileManager.local();
  return { files, path: files.joinPath(files.libraryDirectory(), CACHE_FILE) };
}

function readCredentials() {
  try {
    if (!Keychain.contains(KEYCHAIN_KEY)) return null;
    const value = JSON.parse(Keychain.get(KEYCHAIN_KEY));
    return value && typeof value.phone === "string" && /^\d{10}$/.test(value.phone) && typeof value.password === "string"
      && value.password.trim() && typeof value.profileId === "string" && value.profileId
      ? value : null;
  } catch {
    debugLog("No se pudo leer la configuración.");
    return null;
  }
}

async function notify(title, message) {
  const notice = new Alert();
  notice.title = title;
  notice.message = message;
  notice.addAction("Aceptar");
  await notice.presentAlert();
}

async function configureCredentials(existing) {
  const alert = new Alert();
  alert.title = "Configurar Telcel";
  alert.message = "Tus datos se guardan solo en este iPhone, en el Keychain de iOS.";
  alert.addTextField("Número de 10 dígitos", existing ? existing.phone : "");
  alert.addSecureTextField("Contraseña de Mi Telcel", "");
  alert.addAction("Guardar");
  alert.addCancelAction("Cancelar");
  if (await alert.presentAlert() !== 0) return null;
  const phone = alert.textFieldValue(0).replace(/[\s()-]/g, "");
  const password = alert.textFieldValue(1);
  if (!/^\d{10}$/.test(phone) || !password.trim()) {
    await notify("Revisa tus datos", "Ingresa un número de 10 dígitos y tu contraseña de Mi Telcel.");
    return null;
  }
  const credentials = { phone, password, profileId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
  try {
    Keychain.set(KEYCHAIN_KEY, JSON.stringify(credentials));
  } catch {
    await notify("No se pudo guardar", "Intenta configurar tus datos nuevamente.");
    return null;
  }
  try {
    const { files, path } = cacheLocation();
    if (files.fileExists(path)) files.remove(path);
  } catch {
    // El profileId también evita reutilizar la lectura de otra cuenta.
    debugLog("No se pudo limpiar la lectura anterior.");
  }
  return credentials;
}

function forgetAccount() {
  try { if (Keychain.contains(KEYCHAIN_KEY)) Keychain.remove(KEYCHAIN_KEY); } catch { /* Sin cuenta guardada. */ }
  try {
    const { files, path } = cacheLocation();
    if (files.fileExists(path)) files.remove(path);
  } catch { /* Sin lectura guardada. */ }
}

// Al ejecutar a mano en Scriptable se muestra un menú; en la pantalla de inicio nunca.
async function credentialsForRun() {
  const existing = readCredentials();
  if (config.runsInWidget) return { credentials: existing, cancelled: false, refresh: false };
  if (existing) {
    const menu = new Alert();
    menu.title = "Telcel Widget";
    menu.addAction("Ver widget");
    menu.addAction("Actualizar ahora");
    menu.addAction("Cambiar datos");
    menu.addAction("Personalizar u obtener nueva versión");
    menu.addDestructiveAction("Borrar mis datos");
    menu.addCancelAction("Cancelar");
    const action = await menu.presentSheet();
    if (action === 0) return { credentials: existing, cancelled: false, refresh: false };
    if (action === 1) return { credentials: existing, cancelled: false, refresh: true };
    if (action === 3) {
      Safari.open(generatorURL());
      return { credentials: existing, cancelled: true, refresh: false };
    }
    if (action === 4) {
      forgetAccount();
      await notify("Datos borrados", "Se eliminaron tu cuenta y la última lectura de este iPhone.");
      return { credentials: null, cancelled: true, refresh: false };
    }
    if (action !== 2) return { credentials: existing, cancelled: true, refresh: false };
  }
  const credentials = await configureCredentials(existing);
  return { credentials, cancelled: credentials === null, refresh: false };
}

// ---------- Lectura guardada ----------

function isUsageData(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    && typeof data.plan_name === "string"
    && ["total_data", "used_data", "remaining_data", "days_until"].every(key => typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0)
    && ["total_unit", "used_unit", "remaining_unit"].every(key => ["MB", "GB"].includes(data[key]))
    && Number.isInteger(data.days_until)
    && ["used_percentage", "remaining_percentage"].every(key => data[key] === null || (typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] >= 0))
    && typeof data.last_updated === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(data.last_updated)
    && typeof data.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.expiration_date);
}

function readCache(credentials) {
  try {
    const { files, path } = cacheLocation();
    if (!files.fileExists(path)) return null;
    const cache = JSON.parse(files.readString(path));
    if (cache.profileId !== credentials.profileId || !(cache.data === null || isUsageData(cache.data))
      || !Number.isFinite(cache.fetchedAt) || cache.fetchedAt < 0 || cache.fetchedAt > Date.now()
      || !Number.isFinite(cache.retryAt) || cache.retryAt < 0) return null;
    return cache;
  } catch {
    debugLog("Caché no disponible.");
    return null;
  }
}

function writeCache(credentials, cache) {
  try {
    const { files, path } = cacheLocation();
    files.writeString(path, JSON.stringify({ profileId: credentials.profileId, ...cache }));
    debugLog("Caché guardada.");
  } catch {
    debugLog("No se pudo guardar la lectura.");
  }
}

// ---------- Red ----------

function retryDeadline(headers) {
  const key = Object.keys(headers).find(name => name.toLowerCase() === "retry-after");
  const value = key ? String(headers[key]).trim() : "";
  const deadline = /^\d+$/.test(value) ? Date.now() + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(deadline) && deadline > Date.now() ? deadline : Date.now() + SETTINGS.retryMinutes * 60000;
}

async function requestResponse(url, stage, options = {}) {
  const request = new Request(url);
  request.method = options.method || "GET";
  request.headers = { Accept: "application/json", ...options.headers };
  request.timeoutInterval = options.timeoutSeconds || SETTINGS.requestTimeoutSeconds;
  if (options.body !== undefined) request.body = options.body;
  let redirectLocation = "";
  if (options.manualRedirects) request.onRedirect = next => {
    redirectLocation = next && typeof next.url === "string" ? next.url : "";
    return null;
  };
  const startedAt = Date.now();
  debugLog(`Solicitud ${stage}: iniciada.`);
  let text;
  try {
    text = await request.loadString();
  } catch {
    debugLog(`Solicitud ${stage}: fallo de red o tiempo agotado.`);
    throw diagnosticError(`${stage}_network`);
  }
  const status = request.response ? request.response.statusCode : 0;
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : "desconocido";
  debugLog(`Solicitud ${stage}: HTTP ${safeStatus} (${Date.now() - startedAt} ms).`);
  const allowedRedirect = options.acceptRedirects && [301, 302, 303, 307, 308].includes(status);
  if (!Number.isInteger(status) || status < 200 || (status >= 300 && !allowedRedirect)) {
    const error = diagnosticError(`${stage}_http_${status}`);
    if (status === 429) {
      error.retryAt = retryDeadline(request.response.headers || {});
      debugLog(`Límite de Telcel: esperar ${Math.ceil((error.retryAt - Date.now()) / 60000)} min.`);
    }
    throw error;
  }
  return { text, status, headers: request.response.headers || {}, redirectLocation };
}

async function requestText(url, stage, options = {}) {
  return (await requestResponse(url, stage, options)).text;
}

async function requestJson(url, stage, options = {}) {
  const text = await requestText(url, stage, options);
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    // No se registra la respuesta cruda ni el error del parser.
  }
  debugLog(`Respuesta no válida: ${stage}_json.`);
  throw diagnosticError(`${stage}_json`);
}

function formBody(values) {
  return Object.keys(values).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`).join("&");
}

// ---------- Telcel: sesión y consumo ----------

// Lee como texto (sin ejecutarlo) el valor de cliente que usa la web de Mi Telcel.
async function discoverBasicAuth() {
  const origin = "https://www.mitelcel.com";
  const sameOrigin = url => typeof url === "string" && url.startsWith(`${origin}/`);
  async function download(url) {
    for (let hop = 0; hop < 4; hop++) {
      if (!sameOrigin(url)) throw new Error("Unsupported configuration origin");
      const request = new Request(url);
      request.method = "GET";
      request.headers = { Accept: "text/html, application/javascript", Cookie: "" };
      request.timeoutInterval = 5;
      // Cada redirección se revisa antes de seguirla.
      request.onRedirect = () => null;
      const text = await request.loadString();
      const response = request.response;
      const status = response && response.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const key = Object.keys(response.headers || {}).find(name => name.toLowerCase() === "location");
        const location = key && response.headers[key];
        if (typeof location !== "string" || !location || /[\\\x00-\x20\x7F]/.test(location) || location.startsWith("//")) throw new Error("Invalid configuration redirect");
        url = location.startsWith("/") ? origin + location
          : /^[A-Za-z][A-Za-z0-9+.-]*:/.test(location) ? location
          : url.split(/[?#]/)[0].slice(0, url.split(/[?#]/)[0].lastIndexOf("/") + 1) + location;
        continue;
      }
      if (!Number.isInteger(status) || status < 200 || status >= 300) throw new Error("Configuration unavailable");
      return text;
    }
    throw new Error("Too many configuration redirects");
  }
  try {
    const html = await download(`${origin}/mitelcel/login`);
    let bundle = null;
    for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
      const source = /(?:^|\s)src\s*=\s*(["'])([^"']+)\1/i.exec(tag);
      if (!source) continue;
      let url = source[2].replace(/&amp;/g, "&");
      if (url.startsWith("/assets/")) url = origin + url;
      else if (url.startsWith("assets/")) url = origin + "/" + url;
      if (sameOrigin(url) && /^\/assets\/index-[A-Za-z0-9_.-]+\.js(?:\?[^#\s"'<>]*)?(?:#.*)?$/.test(url.slice(origin.length))) {
        bundle = url;
        break;
      }
    }
    if (!bundle) throw new Error("Missing application bundle");
    const script = await download(bundle);
    const match = /\bMTL_AUTHORIZATION_BASIC["']?\s*:\s*(["'])([^"'\r\n]+)\1/.exec(script);
    const value = match && match[2];
    if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid client configuration");
    const decoded = Data.fromBase64String(value).toRawString();
    if (decoded.indexOf(":") <= 0 || /[\x00-\x1F\x7F]/.test(decoded)) throw new Error("Invalid client configuration");
    debugLog("Configuración del cliente Telcel obtenida.");
    return value;
  } catch {
    debugLog("No se pudo obtener la configuración Telcel; usando respaldo.");
  }
  const fallback = Data.fromBase64String(CLIENT_AUTH).toRawString().trim();
  if (!fallback || /[\x00-\x1F\x7F]/.test(fallback)) throw diagnosticError("configuration");
  return fallback;
}

async function loginLegacy(credentials) {
  debugLog("Inicio de sesión normal.");
  const login = await requestJson("https://wbl.telcel-id.com:8443/login", "login", {
    method: "POST",
    headers: {
      Origin: "https://wbl.telcel-id.com:8443",
      Referer: "https://wbl.telcel-id.com:8443/login?sitedomain=https://www.mitelcel.com&CCode=52&Type=MSISDN&Invocation=iFrame",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": WEB_USER_AGENT,
    },
    body: formBody({
      username: credentials.phone,
      "telcel-pass": credentials.password,
      pB64: Data.fromString(credentials.password).toBase64String(),
      CCode: "52",
      sitedomain: "https://www.mitelcel.com",
      Type: "MSISDN", Invocation: "iFrame", MSISDN: credentials.phone, Source: "",
      url: "https://wbl.telcel-id.com:8443",
    }),
  });
  if (login.estatus !== "ok" || typeof login.token !== "string" || !login.token.trim()) throw diagnosticError("login_rejected");
  return login.token;
}

function headerValue(headers, name) {
  const key = Object.keys(headers).find(key => key.toLowerCase() === name);
  return key && typeof headers[key] === "string" ? headers[key] : "";
}

function oidcCode(response, state) {
  let json = null;
  try { json = JSON.parse(response.text); } catch {}
  const candidates = json && typeof json === "object" && !Array.isArray(json) ? [json] : [];
  const locations = [headerValue(response.headers, "x-oidc-redirect-location"),
    headerValue(response.headers, "location"), response.redirectLocation,
    candidates.length ? "" : response.text.trim()];
  for (const location of locations) {
    if (typeof location !== "string" || !location || location.includes("<") || !/^(https?:\/\/|\/|\?|code=|error=)/.test(location)) continue;
    const query = (location.includes("?") ? location.slice(location.indexOf("?") + 1) : location).split("#")[0];
    const values = {};
    try {
      for (const pair of query.split("&")) {
        const index = pair.indexOf("=");
        const key = decodeURIComponent((index < 0 ? pair : pair.slice(0, index)).replace(/\+/g, " "));
        const value = decodeURIComponent((index < 0 ? "" : pair.slice(index + 1)).replace(/\+/g, " "));
        if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) throw diagnosticError("oidc_code");
        values[key] = value;
      }
    } catch { throw diagnosticError("oidc_code"); }
    candidates.push(values);
  }
  const codes = new Set();
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(candidate, "state") && candidate.state !== state) throw diagnosticError("oidc_state");
    if (candidate.error || candidate.error_description) throw diagnosticError("oidc_authorize_rejected");
    if (typeof candidate.code === "string" && candidate.code.trim()) codes.add(candidate.code.trim());
  }
  if (codes.size !== 1) throw diagnosticError("oidc_code");
  return [...codes][0];
}

// Segundo método de acceso, solo si el normal falla.
async function loginOidc(credentials) {
  const base = "https://www.mitelcel.com/oid-authorize-prod";
  const clientId = "31f419f6-5446-4e7e-a275-daf60f568698";
  const redirectUri = "https://mtl.smapps.mx:1333/sso/callback";
  const state = UUID.string();
  const response = await requestResponse(`${base}/authorize?${formBody({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid",
    acr_values: "1", state, nonce: UUID.string(),
  })}`, "oidc_authorize", {
    manualRedirects: true, acceptRedirects: true,
    headers: { USERNAME: `52${credentials.phone}`, PASSWORD: credentials.password,
      Accept: "application/json", "Accept-Charset": "UTF-8", "User-Agent": WEB_USER_AGENT },
  });
  const code = oidcCode(response, state);
  debugLog("OIDC: código de autorización recibido.");
  const tokens = await requestJson(`${base}/token`, "oidc_token", {
    method: "POST", manualRedirects: true,
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": WEB_USER_AGENT },
    body: formBody({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code }),
  });
  const entries = tokens.tokenResponse && tokens.tokenResponse.tokens;
  const nested = Array.isArray(entries) ? entries.find(entry => entry && entry.id === "token:mit") : null;
  // Telcel puede incluir error: "Seccessful" junto a un token válido.
  const token = [tokens.access_token, nested && nested.access_token, tokens.token]
    .find(value => typeof value === "string" && value.trim());
  if (!token) throw diagnosticError(tokens.error ? "oidc_token_rejected" : "oidc_token_missing");
  debugLog("OIDC: sesión obtenida.");
  return token;
}

async function loginTelcel(credentials) {
  if (!/^\d{10}$/.test(credentials.phone) || typeof credentials.password !== "string" || !credentials.password.trim()) throw diagnosticError("configuration");
  let legacyError;
  try {
    return await loginLegacy(credentials);
  } catch (error) {
    legacyError = error;
    debugLog(`Inicio normal falló: ${diagnosticError(error.code || "unknown").code}. Intentando OIDC una vez.`);
  }
  try {
    return await loginOidc(credentials);
  } catch (error) {
    if (legacyError.retryAt) error.retryAt = Math.max(error.retryAt || 0, legacyError.retryAt);
    throw error;
  }
}

// Inicia sesión, pide el consumo y siempre cierra la sesión al terminar.
async function fetchUsage(credentials) {
  const ssoToken = await loginTelcel(credentials);
  try {
    const basicAuth = await discoverBasicAuth();
    const tokens = await requestJson(`https://mi-telcel.smapps.mx/security/1.0.0/v2/token?user=${encodeURIComponent(credentials.phone)}&token=${encodeURIComponent(ssoToken)}`, "token", {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json", "Content-Type": "application/json",
        tipoRequest: "1", "User-Agent": "ktor-client",
        "app-version": "0.14", "code-version": "38", "device-id": "DSK",
        os: "WEB", "os-version": "13", scope: "token:mit|token:b2f", "x-channel": "web-browser",
      },
    });
    const entries = tokens.tokenResponse && tokens.tokenResponse.tokens;
    const access = Array.isArray(entries) ? entries.find(entry => entry && entry.id === "token:b2f") : null;
    if (tokens.message !== "Éxito." || !access || typeof access.access_token !== "string" || !access.access_token.trim()) throw diagnosticError("token_missing");
    const response = await requestJson(`https://api.journeys.telcel.wavebybemobi.com/api/components/flow/home?externalCode=${encodeURIComponent(credentials.phone)}`, "usage", {
      headers: {
        Authorization: `Bearer ${access.access_token}`,
        Accept: "application/json", "Content-Type": "application/json",
        "X-Is-iPad": "false", "x-wave-sdk": "WEB", "x-wave-device": "iPhone",
        "x-wave-device-type": "mobile", "x-wave-os": "iOS-web",
        "x-wave-os-version": "18.0", "User-Agent": WEB_USER_AGENT,
      },
    });
    return parseUsage(response);
  } finally {
    debugLog("Cierre de sesión.");
    try {
      await requestText("https://dev.smapps.mx:9000/sso/revoke", "logout", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ token: ssoToken, token_type: "revoke" }), timeoutSeconds: 5,
      });
    } catch {
      debugLog("No se pudo completar el cierre de sesión.");
    }
  }
}

// Convierte la pantalla de inicio de Mi Telcel en una lectura simple.
function parseUsage(response) {
  function find(node, id) {
    if (node && typeof node === "object") {
      if (node.id === id) return node.config ?? null;
      for (const value of Object.values(node)) {
        const result = find(value, id);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }
  function component(id) {
    const result = find(response, id);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw diagnosticError("usage_data");
    return result;
  }
  function value(id) {
    const result = component(id).value;
    if (typeof result !== "string" && typeof result !== "number") throw diagnosticError("usage_data");
    return String(result);
  }
  function number(id) {
    let text = value(id).trim();
    if (text.includes(",")) {
      if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) throw diagnosticError("usage_data");
      text = text.replace(/,/g, "");
    }
    const result = Number(text);
    if (!text.trim() || !Number.isFinite(result) || result < 0) throw diagnosticError("usage_data");
    return result;
  }
  function date(year, month, day) {
    const result = new Date(Date.UTC(year, month - 1, day));
    if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) throw diagnosticError("usage_data");
    return result;
  }
  const corporate = response !== null && typeof response === "object" && response.id === "home-corpo";
  const plan = value(corporate ? "text-plan-name" : "tabs-plans-v2-plan-name-0-0-0");
  function dataReading(kind) {
    const amount = number(`tabs-plans-v2-${kind}-data-value-0-0-0`);
    const unitId = `tabs-plans-v2-${kind}-data-unit-0-0-0`;
    // Las respuestas antiguas sin unidad venían en GB.
    const unit = find(response, unitId) === undefined ? "GB" : value(unitId).trim().toUpperCase();
    if (["MB", "GB"].includes(unit)) return { amount, unit };
    throw diagnosticError("usage_data");
  }
  const totalReading = dataReading("total");
  const usedReading = dataReading("used");
  const remainingReading = dataReading("available");
  const toGB = reading => reading.unit === "MB" ? reading.amount / 1000 : reading.amount;
  const total = toGB(totalReading);
  const used = toGB(usedReading);
  const remaining = toGB(remainingReading);
  const legacyId = ["last-update-text", "last-update-text-web"].find(id => find(response, id) !== undefined);
  let parts;
  let seconds = "00";
  if (legacyId) {
    const updated = value(legacyId).replace("Información al ", "").replace(" h", "").trim();
    parts = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(updated);
  } else {
    const chartId = ["tabs-plans-v2-usage-chart-0-0-0", "tabs-plans-v2-usage-chart-web-0-0-0"].find(id => find(response, id) !== undefined);
    if (!chartId) throw diagnosticError("usage_data");
    const entries = component(chartId).data;
    const available = Array.isArray(entries) && entries.find(entry => entry && entry.key === "available");
    const timestamp = available && available.updatedAt;
    if (typeof timestamp !== "string" || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) throw diagnosticError("usage_data");
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime())) throw diagnosticError("usage_data");
    const fields = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map(part => [part.type, part.value]));
    parts = [null, fields.day, fields.month, fields.year, fields.hour, fields.minute];
    seconds = fields.second;
  }
  if (!parts || Number(parts[4]) > 23 || Number(parts[5]) > 59) throw diagnosticError("usage_data");
  const year = Number(parts[3]);
  const readingDate = date(year, Number(parts[2]), Number(parts[1]));
  const segments = component("tabs-plans-v2-limited-cutoff-message-0-0-0").segments;
  if (!Array.isArray(segments) || segments.some(s => !s || typeof s.text !== "string")) throw diagnosticError("usage_data");
  const message = segments.map(s => s.text).join("");
  const days = /\bFaltan?\s+(\d+)\b/i.exec(message);
  const expiresToday = /^\s*Hoy\s+vence\s+tu\s+paquete\.?\s*$/i.test(message);
  if (!days && !expiresToday) throw diagnosticError("usage_data");
  const daysUntil = expiresToday ? 0 : Number(days[1]);
  let expiration;
  if (corporate && find(response, "text-due-value") === undefined) {
    expiration = new Date(readingDate.getTime() + daysUntil * 86400000);
    if (!Number.isFinite(expiration.getTime())) throw diagnosticError("usage_data");
  } else {
    const due = /^(\d{1,2}) de ([a-z]+)$/.exec(value("text-due-value").trim().toLowerCase());
    const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    if (!due || !months.includes(due[2])) throw diagnosticError("usage_data");
    expiration = date(year, months.indexOf(due[2]) + 1, Number(due[1]));
    if (expiration < readingDate) expiration = date(year + 1, months.indexOf(due[2]) + 1, Number(due[1]));
  }
  const data = {
    plan_name: plan, expiration_date: expiration.toISOString().slice(0, 10), days_until: daysUntil,
    last_updated: `${parts[3]}-${parts[2]}-${parts[1]}T${parts[4]}:${parts[5]}:${seconds}`,
    total_data: totalReading.amount, total_unit: totalReading.unit,
    used_data: usedReading.amount, used_unit: usedReading.unit,
    remaining_data: remainingReading.amount, remaining_unit: remainingReading.unit,
    used_percentage: total ? Math.round(used / total * 10000) / 100 : null,
    remaining_percentage: total ? Math.round(remaining / total * 10000) / 100 : null,
  };
  if (!isUsageData(data)) throw diagnosticError("usage_data");
  return data;
}

// Decide si se usa la lectura guardada o se consulta a Telcel.
async function loadUsage(credentials, forceRefresh = false) {
  const now = Date.now();
  const cache = readCache(credentials);
  if (!forceRefresh && cache && cache.retryAt > now) {
    debugLog(`Actualización en pausa: faltan ${Math.ceil((cache.retryAt - now) / 60000)} min.`);
    return { data: cache.data, updateFailed: true };
  }
  if (!forceRefresh && cache && cache.data && now - cache.fetchedAt < SETTINGS.cacheMinutes * 60000) {
    debugLog(`Usando lectura guardada: ${Math.floor((now - cache.fetchedAt) / 60000)} min de antigüedad.`);
    return { data: cache.data, updateFailed: false };
  }
  debugLog("Consultando a Telcel.");
  try {
    const data = await fetchUsage(credentials);
    debugLog("Lectura recibida y validada.");
    writeCache(credentials, { data, fetchedAt: Date.now(), retryAt: 0 });
    return { data, updateFailed: false };
  } catch (error) {
    const data = cache ? cache.data : null;
    const retryAt = error.retryAt || Date.now() + SETTINGS.retryMinutes * 60000;
    writeCache(credentials, { data, fetchedAt: cache ? cache.fetchedAt : 0, retryAt });
    debugLog(`No se pudo actualizar: ${diagnosticError(error.code || "unknown").code}.`);
    debugLog(`Próximo intento permitido en ${Math.ceil((retryAt - Date.now()) / 60000)} min.`);
    return { data, updateFailed: true, errorCode: diagnosticError(error.code || "unknown").code };
  }
}

// ---------- Imagen de fondo (opcional) ----------

async function loadBackgroundImage() {
  const url = imageURL();
  if (!url) return null;
  let files, imagePath, metaPath;
  try {
    files = FileManager.local();
    imagePath = files.joinPath(files.libraryDirectory(), `${IMAGE_CACHE_FILE}.img`);
    metaPath = files.joinPath(files.libraryDirectory(), `${IMAGE_CACHE_FILE}.json`);
    if (files.fileExists(imagePath) && files.fileExists(metaPath)) {
      const meta = JSON.parse(files.readString(metaPath));
      if (meta && meta.url === url && Number.isFinite(meta.savedAt) && Date.now() - meta.savedAt < 86400000) {
        const saved = files.readImage(imagePath);
        if (saved) return saved;
      }
    }
  } catch { /* Sin imagen guardada. */ }
  try {
    const request = new Request(url);
    request.timeoutInterval = 10;
    const image = await request.loadImage();
    try {
      files.writeImage(imagePath, image);
      files.writeString(metaPath, JSON.stringify({ url, savedAt: Date.now() }));
    } catch { /* La imagen se muestra aunque no se pueda guardar. */ }
    return image;
  } catch {
    debugLog("No se pudo cargar la imagen de fondo.");
    try { if (files && files.fileExists(imagePath)) return files.readImage(imagePath); } catch { /* Sin respaldo. */ }
    return null;
  }
}

// ---------- Dibujo del widget ----------

// Recorta la imagen al cuadro del widget y le pone encima una capa del color de fondo para que el texto se lea.
function drawBackground(image) {
  const edge = 360;
  const context = new DrawContext();
  context.size = new Size(edge, edge);
  context.opaque = true;
  context.respectScreenScale = false;
  const scale = Math.max(edge / image.size.width, edge / image.size.height);
  const width = image.size.width * scale, height = image.size.height * scale;
  context.drawImageInRect(image, new Rect((edge - width) / 2, (edge - height) / 2, width, height));
  context.setFillColor(new Color(COLORS.background, overlayOpacity()));
  context.fillRect(new Rect(0, 0, edge, edge));
  return context.getImage();
}

function formatAmount(value, unit) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  return unit === "MB" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value.toFixed(1);
}

function clampPercentage(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function formatExpiration(value) {
  const [, month, day] = value.split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

function expirationText(data) {
  const when = data.days_until === 0 ? "hoy" : data.days_until === 1 ? "mañana" : `en ${data.days_until} días`;
  return `Vence ${formatExpiration(data.expiration_date)} · ${when}`;
}

const pad = value => String(value).padStart(2, "0");

function formatRunTime(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatReadingTime(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  return parts ? `${parts[3]}/${parts[2]} ${parts[4]}:${parts[5]}` : "—";
}

function drawProgressBar(percentage) {
  const context = new DrawContext();
  context.size = new Size(BAR_WIDTH, BAR_HEIGHT);
  context.opaque = false;
  context.respectScreenScale = true;
  const round = SETTINGS.barCorners === "round";
  function fill(width, color) {
    if (width <= 0) return;
    context.setFillColor(color);
    if (!round) {
      context.fillRect(new Rect(0, 0, width, BAR_HEIGHT));
      return;
    }
    const radius = Math.min(BAR_HEIGHT / 2, width / 2);
    const path = new Path();
    path.addRoundedRect(new Rect(0, 0, width, BAR_HEIGHT), radius, radius);
    context.addPath(path);
    context.fillPath();
  }
  fill(BAR_WIDTH, new Color(COLORS.muted, 0.28));
  fill(BAR_WIDTH * clampPercentage(percentage) / 100, new Color(COLORS.accent));
  return context.getImage();
}

function drawProgressArc(percentage) {
  const context = new DrawContext();
  context.size = new Size(112, 68);
  context.opaque = false;
  context.respectScreenScale = true;
  const round = SETTINGS.barCorners === "round";
  function strokeArc(fraction, color) {
    if (fraction <= 0) return;
    const steps = Math.max(1, Math.ceil(fraction * 90));
    const path = new Path();
    let start, end;
    for (let i = 0; i <= steps; i++) {
      const angle = Math.PI + Math.PI * fraction * i / steps;
      const point = new Point(56 + 53 * Math.cos(angle), 56 + 53 * Math.sin(angle));
      if (i === 0) { start = point; path.move(point); }
      else path.addLine(point);
      end = point;
    }
    context.setStrokeColor(color);
    context.setLineWidth(5);
    context.addPath(path);
    context.strokePath();
    if (!round) return;
    context.setFillColor(color);
    for (const point of [start, end]) context.fillEllipse(new Rect(point.x - 2.5, point.y - 2.5, 5, 5));
  }
  strokeArc(1, new Color(COLORS.muted, 0.28));
  strokeArc(clampPercentage(percentage) / 100, new Color(COLORS.accent));
  return context.getImage();
}

function addText(stack, value, textFont, color) {
  const text = stack.addText(value);
  text.font = textFont;
  text.textColor = new Color(color);
  text.lineLimit = 1;
  text.minimumScaleFactor = 0.7;
  return text;
}

function statusNotice(updateFailed, updateAvailable) {
  if (updateAvailable) return updateFailed ? "Sin actualizar · Nueva versión" : "Nueva versión disponible";
  return updateFailed ? "No se pudo actualizar" : "";
}

function addFooter(widget, data, updateFailed, updateAvailable) {
  const notice = statusNotice(updateFailed, updateAvailable);
  widget.addSpacer(3);
  if (notice) {
    addText(widget, notice, font("medium", 8), COLORS.text);
  } else if (data) {
    addText(widget, `Dato de Telcel · ${formatReadingTime(data.last_updated)}`, font("regular", 8), COLORS.muted);
  }
  widget.addSpacer(1);
  addText(widget, `Revisado · ${formatRunTime(RUN_AT)}`, font("regular", 8), COLORS.muted);
}

function createWidget({ data, updateFailed = false, setupRequired = false, updateAvailable = false, backgroundImage = null }) {
  const widget = new ListWidget();
  if (updateAvailable) widget.url = generatorURL();
  widget.backgroundColor = new Color(COLORS.background);
  if (backgroundImage) widget.backgroundImage = drawBackground(backgroundImage);
  widget.setPadding(12, 12, 12, 12);
  // Pide a iOS la siguiente actualización cuando venza la lectura guardada. iOS decide el momento real.
  widget.refreshAfterDate = new Date(Date.now() + Math.max(5, Number(SETTINGS.cacheMinutes) || 30) * 60000);

  const header = widget.addStack();
  header.centerAlignContent();
  if (SETTINGS.showPlanName !== false) {
    const title = header.addStack();
    title.size = new Size(92, 14);
    addText(title, data && data.plan_name ? data.plan_name : "Consumo", font("medium", 11), COLORS.text);
    title.addSpacer();
    header.addSpacer();
    addText(header, CARRIER_NAME, font("medium", 8), labelColor());
  } else {
    addText(header, CARRIER_NAME, font("medium", 10), labelColor());
  }

  if (!data) {
    widget.addSpacer();
    addText(widget, setupRequired ? "Configura tu cuenta" : "No se pudo cargar", font("medium", 13), COLORS.text);
    widget.addSpacer(4);
    addText(widget, setupRequired ? "Toca para abrir Scriptable" : "Se intentará más tarde", font("regular", 10), COLORS.muted);
    widget.addSpacer();
    addFooter(widget, null, setupRequired ? false : updateFailed, updateAvailable);
    return widget;
  }

  const style = chartStyle();
  widget.addSpacer();
  const body = widget.addStack();
  body.addSpacer();
  let balanceParent = body;
  if (style === "arc") {
    const arc = body.addStack();
    arc.layoutVertically();
    arc.size = new Size(112, 68);
    arc.backgroundImage = drawProgressArc(data.used_percentage);
    arc.addSpacer(30);
    balanceParent = arc;
  }
  const reading = balanceParent.addStack();
  reading.bottomAlignContent();
  if (style === "arc") {
    reading.size = new Size(112, 38);
    reading.addSpacer();
  }
  const value = formatAmount(data.remaining_data, data.remaining_unit);
  const valueSize = style === "arc" ? (value.length > 4 ? 28 : 30) : style === "none" ? 40 : 34;
  addText(reading, value, font("bold", valueSize), COLORS.text);
  reading.addSpacer(4);
  const unit = reading.addStack();
  unit.layoutVertically();
  addText(unit, data.remaining_unit, font("medium", 13), COLORS.muted);
  unit.addSpacer(style === "arc" ? 5 : 7);
  if (style === "arc") reading.addSpacer();
  body.addSpacer();

  const caption = widget.addStack();
  caption.addSpacer();
  addText(caption, `disponibles de ${formatAmount(data.total_data, data.total_unit)} ${data.total_unit}`, font("regular", 10), COLORS.muted);
  caption.addSpacer();
  if (style === "bar") {
    widget.addSpacer(5);
    const bar = widget.addStack();
    bar.addSpacer();
    const progress = bar.addImage(drawProgressBar(data.used_percentage));
    progress.imageSize = new Size(BAR_WIDTH, BAR_HEIGHT);
    bar.addSpacer();
  }
  if (style !== "none") {
    widget.addSpacer(3);
    const used = widget.addStack();
    used.addSpacer();
    addText(used, `${Math.round(clampPercentage(data.used_percentage))}% utilizado`, font("regular", 9), COLORS.muted);
    used.addSpacer();
  }
  widget.addSpacer();
  addText(widget, expirationText(data), font("regular", 9), COLORS.muted);
  addFooter(widget, data, updateFailed, updateAvailable);
  return widget;
}

// ---------- Ejecución ----------

async function main() {
  debugLog("Ejecución iniciada.");
  let result;
  if (SETTINGS.useSampleData) {
    debugLog("Modo de ejemplo: sin consultas a Telcel.");
    result = {
      data: ["error", "setup"].includes(SETTINGS.sampleState) ? null : SAMPLE_DATA,
      updateFailed: SETTINGS.sampleState === "stale" || SETTINGS.sampleState === "error",
      setupRequired: SETTINGS.sampleState === "setup",
      updateAvailable: SETTINGS.sampleState === "update",
    };
  } else {
    const { credentials, cancelled, refresh } = await credentialsForRun();
    if (cancelled) {
      debugLog("Ejecución cancelada.");
      Script.complete();
      return;
    }
    const [usage, updateAvailable] = await Promise.all([
      credentials ? loadUsage(credentials, refresh) : Promise.resolve({ data: null, setupRequired: true }),
      checkForUpdate(),
    ]);
    result = { ...usage, updateAvailable };
    if (!config.runsInWidget && usage.errorCode && !usage.data) {
      const rejected = ["login_rejected", "oidc_authorize_rejected", "oidc_token_rejected"].includes(usage.errorCode);
      await notify("No se pudo consultar Telcel", rejected
        ? "Telcel no aceptó el número o la contraseña. Ejecuta de nuevo y elige Cambiar datos."
        : `Intenta más tarde. Código: ${usage.errorCode}`);
    }
  }
  result.backgroundImage = await loadBackgroundImage();
  const widget = createWidget(result);
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentSmall();
  debugLog("Widget mostrado. Ejecución finalizada.");
  Script.complete();
}

await main();
