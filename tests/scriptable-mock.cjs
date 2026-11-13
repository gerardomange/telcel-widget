// Simulación mínima de Scriptable para ejecutar widget/telcel.js en Node.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = path.join(__dirname, "..", "widget", "telcel.js");
const KEY = "attego-telcel-widget.credentials.v1";
const CACHE = "/library/attego-telcel-widget-usage-v1.json";
const CREDENTIALS = { phone: "5512345678", password: "clave-de-prueba", profileId: "perfil-1" };

// Respuesta de ejemplo con la forma que entrega la pantalla de inicio de Mi Telcel.
function homeResponse() {
  return {
    id: "home",
    data: { components: [
      { id: "tabs-plans-v2-plan-name-0-0-0", config: { value: "Amigo Sin Límite 200" } },
      { id: "tabs-plans-v2-total-data-value-0-0-0", config: { value: "7" } },
      { id: "tabs-plans-v2-used-data-value-0-0-0", config: { value: "5.4" } },
      { id: "tabs-plans-v2-available-data-value-0-0-0", config: { value: "1.6" } },
      { id: "last-update-text", config: { value: "Información al 18/10/2026 10:26 h" } },
      { id: "tabs-plans-v2-limited-cutoff-message-0-0-0", config: { segments: [{ text: "Faltan 5 días " }, { text: "para que venza tu paquete" }] } },
      { id: "text-due-value", config: { value: "24 de octubre" } },
    ] },
  };
}

// Respuestas correctas de cada paso: inicio de sesión, token, consumo y cierre.
function fullFlow(home = homeResponse()) {
  return request => {
    const url = request.url;
    if (url.startsWith("https://wbl.telcel-id.com:8443/login")) return { body: JSON.stringify({ estatus: "ok", token: "sso-token" }) };
    if (url.startsWith("https://www.mitelcel.com/")) return { status: 404, body: "" };
    if (url.startsWith("https://mi-telcel.smapps.mx/security/")) {
      return { body: JSON.stringify({ message: "Éxito.", tokenResponse: { tokens: [{ id: "token:b2f", access_token: "b2f-token" }] } }) };
    }
    if (url.startsWith("https://api.journeys.telcel.wavebybemobi.com/")) return { body: JSON.stringify(home) };
    if (url.startsWith("https://dev.smapps.mx:9000/sso/revoke")) return { body: "" };
    if (url.endsWith("/version.json")) return { body: JSON.stringify({ version: "1.0.0" }) };
    return { status: 404, body: "" };
  };
}

async function loadWidget(options = {}) {
  const state = {
    now: options.now ?? Date.parse("2026-10-18T16:29:00Z"),
    keychain: new Map(), files: new Map(), requests: [], texts: [], logs: [],
    widgets: [], previews: 0, alerts: [], opened: [],
    runsInWidget: options.runsInWidget ?? true,
    respond: options.respond ?? fullFlow(),
    alertAnswers: options.alertAnswers ?? [],
  };

  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  class Color { constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; } }
  class Font {
    constructor(name, size) { this.name = name; this.size = size; }
    static systemFont(size) { return new Font("system", size); }
    static mediumSystemFont(size) { return new Font("system-medium", size); }
    static boldSystemFont(size) { return new Font("system-bold", size); }
  }
  class Size { constructor(width, height) { this.width = width; this.height = height; } }
  class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Path { move() {} addLine() {} addRoundedRect() {} }
  class DrawContext {
    constructor() { this.calls = []; }
    setFillColor(color) { this.calls.push(["fill", color]); }
    setStrokeColor() {} setLineWidth() {} addPath() {} fillPath() {} strokePath() {} fillEllipse() {} drawImageInRect() {}
    fillRect(rect) { this.calls.push(["rect", rect]); }
    getImage() { return { drawn: this.calls, size: this.size }; }
  }
  class Stack {
    addStack() { return new Stack(); }
    addSpacer() {}
    addText(value) { state.texts.push(value); return {}; }
    addImage(image) { return { image }; }
    layoutVertically() {} centerAlignContent() {} bottomAlignContent() {} setPadding() {}
  }
  class ListWidget extends Stack {
    constructor() { super(); state.widgets.push(this); }
    async presentSmall() { state.previews++; }
  }
  class Request {
    constructor(url) { this.url = url; this.method = "GET"; this.headers = {}; }
    async respond() {
      state.requests.push({ url: this.url, method: this.method, headers: this.headers, body: this.body });
      const answer = await state.respond(this);
      if (answer instanceof Error) throw answer;
      this.response = { statusCode: answer.status ?? 200, headers: answer.headers ?? {} };
      return answer;
    }
    async loadString() { return (await this.respond()).body ?? ""; }
    async loadImage() { await this.respond(); return { size: new Size(800, 600) }; }
  }
  class Alert {
    constructor() { this.fields = []; this.actions = []; state.alerts.push(this); }
    addTextField(placeholder, value) { this.fields.push(value ?? ""); }
    addSecureTextField(placeholder, value) { this.fields.push(value ?? ""); }
    addAction(title) { this.actions.push(title); }
    addDestructiveAction(title) { this.actions.push(title); }
    addCancelAction() {}
    answer() {
      const next = state.alertAnswers.shift() ?? { action: -1 };
      if (next.fields) this.fields = next.fields;
      return next.action;
    }
    async presentAlert() { return this.answer(); }
    async presentSheet() { return this.answer(); }
    textFieldValue(index) { return this.fields[index]; }
  }
  const files = {
    libraryDirectory: () => "/library",
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: file => state.files.has(file),
    readString: file => state.files.get(file),
    writeString: (file, value) => { state.files.set(file, value); },
    readImage: file => state.files.get(file),
    writeImage: (file, image) => { state.files.set(file, image); },
    remove: file => { state.files.delete(file); },
  };

  const sandbox = {
    Date: MockDate, Color, Font, Size, Rect, Point, Path, DrawContext, ListWidget, Request, Alert,
    FileManager: { local: () => files },
    Keychain: {
      contains: key => state.keychain.has(key),
      get: key => state.keychain.get(key),
      set: (key, value) => { state.keychain.set(key, value); },
      remove: key => { state.keychain.delete(key); },
    },
    Data: {
      fromString: value => ({ toBase64String: () => Buffer.from(value, "utf8").toString("base64") }),
      fromBase64String: value => ({ toRawString: () => Buffer.from(value, "base64").toString("utf8") }),
    },
    UUID: { string: () => "00000000-0000-4000-8000-000000000000" },
    Safari: { open: url => { state.opened.push(url); } },
    Script: { setWidget() {}, complete() {} },
    config: { get runsInWidget() { return state.runsInWidget; } },
    console: { log: message => { state.logs.push(String(message)); } },
    Intl, Math, JSON, Promise, Number, String, Object, Array, Set, RegExp, Error, Buffer: undefined,
    encodeURIComponent, decodeURIComponent, parseInt, isFinite,
  };

  let source = fs.readFileSync(SOURCE, "utf8");
  if (options.settings) {
    source = source.replace(/const SETTINGS = \{[\s\S]*?\n\};/, match => `${match}\nObject.assign(SETTINGS, ${JSON.stringify(options.settings)});`);
  }
  if (options.credentials !== null) state.keychain.set(KEY, JSON.stringify(options.credentials ?? CREDENTIALS));
  if (options.setup) options.setup(state);
  // Se sustituye la llamada final por un gancho que expone las funciones internas.
  const marker = "\nawait main();";
  if (!source.includes(marker)) throw new Error("No se encontró la llamada final del script.");
  const body = source.replace(marker, `
return { main, parseUsage, createWidget, loadUsage, fetchUsage, readCredentials, generatorURL, newerVersion, labelColor, COLORS, SETTINGS };`);
  const hooks = await vm.runInNewContext(`(async () => {${body}\n})()`, sandbox);
  return { hooks, state };
}

module.exports = { loadWidget, homeResponse, fullFlow, CREDENTIALS, KEY, CACHE };
