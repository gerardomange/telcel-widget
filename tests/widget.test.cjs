const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWidget, homeResponse, fullFlow, CREDENTIALS, KEY, CACHE } = require("./scriptable-mock.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const SECRETS = [CREDENTIALS.password, "sso-token", "b2f-token"];

test("lee plan, datos, unidad y vencimiento de la respuesta de Telcel", async () => {
  const { hooks } = await loadWidget();
  assert.deepEqual(plain(hooks.parseUsage(homeResponse())), {
    plan_name: "Amigo Sin Límite 200", expiration_date: "2026-10-24", days_until: 5,
    last_updated: "2026-10-18T10:26:00",
    total_data: 7, total_unit: "GB", used_data: 5.4, used_unit: "GB", remaining_data: 1.6, remaining_unit: "GB",
    used_percentage: 77.14, remaining_percentage: 22.86,
  });
});

test("respeta MB cuando Telcel los entrega y calcula el porcentaje en una unidad común", async () => {
  const { hooks, state } = await loadWidget();
  const home = homeResponse();
  home.data.components[2].config.value = "6";
  home.data.components[3].config.value = "1,000";
  home.data.components.push({ id: "tabs-plans-v2-available-data-unit-0-0-0", config: { value: "MB" } });
  const data = hooks.parseUsage(home);
  assert.equal(data.remaining_data, 1000);
  assert.equal(data.remaining_unit, "MB");
  assert.equal(data.remaining_percentage, 14.29);
  hooks.createWidget({ data });
  assert.ok(state.texts.includes("1,000"));
  assert.ok(state.texts.includes("MB"));
  assert.ok(state.texts.includes("disponibles de 7.0 GB"));
});

test("un vencimiento en enero después de una lectura en diciembre cae en el año siguiente", async () => {
  const { hooks } = await loadWidget();
  const home = homeResponse();
  home.data.components[4].config.value = "Información al 29/12/2026 08:00 h";
  home.data.components[6].config.value = "3 de enero";
  assert.equal(hooks.parseUsage(home).expiration_date, "2027-01-03");
});

test("rechaza respuestas incompletas o con cifras inválidas", async () => {
  const { hooks } = await loadWidget();
  for (const index of [0, 1, 3, 4, 5]) {
    const home = homeResponse();
    home.data.components.splice(index, 1);
    assert.throws(() => hooks.parseUsage(home), error => error.code === "usage_data");
  }
  for (const value of ["1,00", "abc", "-1", ""]) {
    const home = homeResponse();
    home.data.components[3].config.value = value;
    assert.throws(() => hooks.parseUsage(home), error => error.code === "usage_data");
  }
  assert.throws(() => hooks.parseUsage(null), error => error.code === "usage_data");
});

test("flujo completo: inicia sesión, consulta, cierra sesión y guarda la lectura", async () => {
  const { hooks, state } = await loadWidget();
  const result = await hooks.loadUsage(CREDENTIALS);
  assert.equal(result.updateFailed, false);
  assert.equal(result.data.remaining_data, 1.6);
  const urls = state.requests.map(request => request.url);
  assert.ok(urls[0].startsWith("https://wbl.telcel-id.com:8443/login"));
  assert.ok(urls.at(-1).startsWith("https://dev.smapps.mx:9000/sso/revoke"));
  assert.ok(urls.every(url => url.startsWith("https://")));
  const cache = JSON.parse(state.files.get(CACHE));
  assert.equal(cache.profileId, CREDENTIALS.profileId);
  assert.equal(cache.retryAt, 0);
  for (const secret of SECRETS) assert.equal(state.files.get(CACHE).includes(secret), false);
});

test("reutiliza la lectura guardada durante cacheMinutes y vuelve a consultar al vencer", async () => {
  const { hooks, state } = await loadWidget();
  await hooks.loadUsage(CREDENTIALS);
  const first = state.requests.length;
  state.now += 29 * 60000;
  await hooks.loadUsage(CREDENTIALS);
  assert.equal(state.requests.length, first);
  state.now += 2 * 60000;
  await hooks.loadUsage(CREDENTIALS);
  assert.ok(state.requests.length > first);
});

test("Actualizar ahora ignora la lectura guardada", async () => {
  const { hooks, state } = await loadWidget();
  await hooks.loadUsage(CREDENTIALS);
  const first = state.requests.length;
  await hooks.loadUsage(CREDENTIALS, true);
  assert.ok(state.requests.length > first);
});

test("si Telcel falla conserva la última lectura y espera retryMinutes", async () => {
  const { hooks, state } = await loadWidget();
  await hooks.loadUsage(CREDENTIALS);
  state.now += 31 * 60000;
  state.respond = () => new Error("sin red");
  const failed = await hooks.loadUsage(CREDENTIALS);
  assert.equal(failed.updateFailed, true);
  assert.equal(failed.data.remaining_data, 1.6);
  const after = state.requests.length;
  state.now += 14 * 60000;
  state.respond = fullFlow();
  assert.equal((await hooks.loadUsage(CREDENTIALS)).updateFailed, true);
  assert.equal(state.requests.length, after);
  state.now += 2 * 60000;
  assert.equal((await hooks.loadUsage(CREDENTIALS)).updateFailed, false);
});

test("credenciales rechazadas: prueba el segundo método una vez y reporta el fallo", async () => {
  const { hooks, state } = await loadWidget({
    respond: request => request.url.includes("/login") ? { body: JSON.stringify({ estatus: "error" }) }
      : request.url.includes("/authorize") ? { status: 401, body: "" } : { status: 404, body: "" },
  });
  const result = await hooks.loadUsage(CREDENTIALS);
  assert.equal(result.data, null);
  assert.equal(result.updateFailed, true);
  assert.equal(state.requests.filter(request => request.url.includes("/authorize")).length, 1);
  assert.equal(state.requests.some(request => request.url.includes("/security/")), false);
});

test("cierra la sesión aunque falle la consulta de consumo", async () => {
  const flow = fullFlow();
  const { hooks, state } = await loadWidget({
    respond: request => request.url.includes("wavebybemobi") ? { status: 500, body: "" } : flow(request),
  });
  const result = await hooks.loadUsage(CREDENTIALS);
  assert.equal(result.errorCode, "usage_http_500");
  assert.ok(state.requests.at(-1).url.includes("/sso/revoke"));
});

test("la lectura de otra cuenta no se reutiliza", async () => {
  const { hooks, state } = await loadWidget();
  await hooks.loadUsage(CREDENTIALS);
  const first = state.requests.length;
  await hooks.loadUsage({ ...CREDENTIALS, profileId: "perfil-2" });
  assert.ok(state.requests.length > first);
});

test("sin cuenta guardada el widget pide configurarla y no consulta a Telcel", async () => {
  const { hooks, state } = await loadWidget({ credentials: null });
  await hooks.main();
  assert.ok(state.texts.includes("Configura tu cuenta"));
  assert.equal(state.requests.some(request => !request.url.endsWith("version.json")), false);
});

test("en la pantalla de inicio no muestra menús ni alertas", async () => {
  const { hooks, state } = await loadWidget();
  await hooks.main();
  assert.equal(state.alerts.length, 0);
  assert.equal(state.previews, 0);
  assert.ok(state.texts.includes("1.6"));
  assert.ok(state.texts.includes("Vence 24 oct · en 5 días"));
  assert.ok(state.texts.includes("Dato de Telcel · 18/10 10:26"));
});

test("primera ejecución manual: guarda la cuenta en el Keychain y muestra el widget", async () => {
  const { hooks, state } = await loadWidget({
    credentials: null, runsInWidget: false,
    alertAnswers: [{ action: 0, fields: ["55 1234-5678", "clave-de-prueba"] }],
  });
  await hooks.main();
  const saved = JSON.parse(state.keychain.get(KEY));
  assert.equal(saved.phone, "5512345678");
  assert.equal(saved.password, "clave-de-prueba");
  assert.equal(state.previews, 1);
});

test("un número inválido no se guarda", async () => {
  const { hooks, state } = await loadWidget({
    credentials: null, runsInWidget: false,
    alertAnswers: [{ action: 0, fields: ["12345", "clave"] }, { action: 0 }],
  });
  await hooks.main();
  assert.equal(state.keychain.has(KEY), false);
  assert.equal(state.requests.length, 0);
});

test("Borrar mis datos elimina la cuenta y la lectura guardada", async () => {
  const { hooks, state } = await loadWidget({ runsInWidget: false, alertAnswers: [{ action: 4 }, { action: 0 }] });
  state.files.set(CACHE, "{}");
  await hooks.main();
  assert.equal(state.keychain.has(KEY), false);
  assert.equal(state.files.has(CACHE), false);
});

test("el registro de depuración y el enlace al generador nunca incluyen datos de la cuenta", async () => {
  const { hooks, state } = await loadWidget({ settings: { debug: true } });
  await hooks.main();
  assert.ok(state.logs.length > 0);
  const exposed = [...state.logs, hooks.generatorURL()].join("\n");
  for (const secret of [...SECRETS, CREDENTIALS.phone]) assert.equal(exposed.includes(secret), false);
});

test("aviso de versión: solo cuando la publicada es mayor", async () => {
  const { hooks } = await loadWidget();
  assert.equal(hooks.newerVersion("1.0.1", "1.0.0"), true);
  assert.equal(hooks.newerVersion("1.0.0", "1.0.0"), false);
  assert.equal(hooks.newerVersion("0.9.9", "1.0.0"), false);
  assert.equal(hooks.newerVersion("1.0", "1.0.0"), false);
  const flow = fullFlow();
  const { hooks: next, state } = await loadWidget({
    respond: request => request.url.endsWith("version.json") ? { body: JSON.stringify({ version: "9.0.0" }) } : flow(request),
  });
  await next.main();
  assert.ok(state.texts.includes("Nueva versión disponible"));
  assert.ok(state.widgets[0].url.startsWith("https://gerardomange.github.io/telcel-widget/?update=1#"));
});

test("modo de ejemplo: no toca la red ni la cuenta", async () => {
  for (const sampleState of ["success", "stale", "error", "setup", "update"]) {
    const { hooks, state } = await loadWidget({ credentials: null, settings: { useSampleData: true, sampleState } });
    await hooks.main();
    assert.equal(state.requests.length, 0);
    assert.equal(state.widgets.length, 1);
  }
});

test("tema Attego por defecto: obsidiana, hueso, bronce, Helvetica Neue y barra recta", async () => {
  const { hooks, state } = await loadWidget();
  assert.equal(hooks.COLORS.background, "0F0F11");
  assert.equal(hooks.COLORS.text, "E6E7E8");
  assert.equal(hooks.COLORS.accent, "9D7D5D");
  assert.equal(hooks.labelColor(), "9D7D5D");
  const widget = hooks.createWidget({ data: hooks.parseUsage(homeResponse()) });
  assert.equal(widget.backgroundColor.hex, "0F0F11");
  assert.ok(state.texts.includes("TELCEL"));
  assert.ok(state.texts.includes("77% utilizado"));
});

test("sobre fondo claro el rótulo deja el bronce y usa el color del texto", async () => {
  const { hooks } = await loadWidget({ settings: { backgroundHex: "E6E7E8", textPrimaryHex: "0F0F11" } });
  assert.equal(hooks.labelColor(), "0F0F11");
});

test("colores inválidos vuelven a los de Attego", async () => {
  const { hooks } = await loadWidget({ settings: { backgroundHex: "rojo", accentHex: "#12", textPrimaryHex: null } });
  assert.equal(hooks.COLORS.background, "0F0F11");
  assert.equal(hooks.COLORS.accent, "9D7D5D");
  assert.equal(hooks.COLORS.text, "E6E7E8");
});

test("imagen de fondo: se descarga una vez y luego se usa la guardada", async () => {
  const flow = fullFlow();
  const settings = { backgroundImageUrl: "https://example.com/fondo.jpg" };
  const respond = request => request.url === settings.backgroundImageUrl ? { body: "" } : flow(request);
  const { hooks, state } = await loadWidget({ settings, respond });
  await hooks.main();
  assert.ok(state.widgets[0].backgroundImage);
  const count = () => state.requests.filter(request => request.url === settings.backgroundImageUrl).length;
  assert.equal(count(), 1);
  await hooks.main();
  assert.equal(count(), 1);
});

test("una imagen que no es https se ignora", async () => {
  const { hooks, state } = await loadWidget({ settings: { backgroundImageUrl: "http://example.com/fondo.jpg" } });
  await hooks.main();
  assert.equal(state.widgets[0].backgroundImage, undefined);
  assert.equal(state.requests.some(request => request.url.startsWith("http://")), false);
});
