const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const G = require("../generator.js");
const { loadWidget } = require("./scriptable-mock.cjs");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "widget", "telcel.js"), "utf8");

test("los valores por defecto del generador son los del script publicado", async () => {
  const { hooks } = await loadWidget();
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.SETTINGS)), G.normalize({}));
  assert.equal(G.themeOf({}), "attego-dark");
});

test("el script generado conserva el código y solo cambia el bloque SETTINGS", () => {
  const script = G.buildScript(TEMPLATE, { ...G.themeValues("classic"), chartStyle: "arc", cacheMinutes: 60 });
  const outside = text => text.replace(/\/\/ <SETTINGS>[\s\S]*?\/\/ <\/SETTINGS>/, "");
  assert.equal(outside(script), outside(TEMPLATE));
  assert.match(script, /accentHex: "FF453A"/);
  assert.match(script, /chartStyle: "arc"/);
  assert.match(script, /cacheMinutes: 60/);
  new vm.Script(`(async () => {${script}\n})`);
});

test("cada tema genera un script que corre y pinta sus colores", async () => {
  for (const id of Object.keys(G.THEMES)) {
    const settings = G.normalize({ ...G.themeValues(id), useSampleData: true });
    const block = G.settingsBlock(settings);
    const values = vm.runInNewContext(`${block}\nSETTINGS`);
    const { hooks, state } = await loadWidget({ credentials: null, settings: JSON.parse(JSON.stringify(values)) });
    await hooks.main();
    assert.equal(state.widgets[0].backgroundColor.hex, G.THEMES[id].backgroundHex);
    assert.equal(G.themeOf(settings), id);
  }
});

test("la entrada se limpia: nada que no sea un valor permitido llega al script", () => {
  const dirty = G.normalize({
    backgroundHex: '"; fetch("https://evil.example") //', accentHex: "#abcdef", chartStyle: "pie", barCorners: 3,
    font: "comic", backgroundImageUrl: 'https://example.com/a.jpg"; alert(1); "', backgroundOverlayOpacity: 7,
    cacheMinutes: 1, sampleState: "x", debug: "true", showPlanName: "false",
  });
  assert.equal(dirty.backgroundHex, "0F0F11");
  assert.equal(dirty.accentHex, "ABCDEF");
  assert.equal(dirty.chartStyle, "bar");
  assert.equal(dirty.barCorners, "square");
  assert.equal(dirty.font, "helvetica");
  assert.equal(dirty.backgroundImageUrl, "");
  assert.equal(dirty.backgroundOverlayOpacity, 1);
  assert.equal(dirty.cacheMinutes, 15);
  assert.equal(dirty.sampleState, "success");
  assert.equal(dirty.debug, false);
  assert.equal(dirty.showPlanName, false);
  assert.equal(G.normalize({ backgroundImageUrl: "http://example.com/a.jpg" }).backgroundImageUrl, "");
  assert.equal(G.normalize({ backgroundImageUrl: " https://example.com/a.jpg " }).backgroundImageUrl, "https://example.com/a.jpg");
});

test("el enlace que arma el widget se recupera completo en el generador", async () => {
  const custom = { backgroundHex: "123456", textPrimaryHex: "FAFAFA", textSecondaryHex: "AAAAAA", accentHex: "00CC88",
    chartStyle: "arc", barCorners: "round", font: "system", showPlanName: false,
    backgroundImageUrl: "https://example.com/fondo.jpg?a=1&b=2", backgroundOverlayOpacity: 0.3 };
  const { hooks } = await loadWidget({ settings: custom });
  const restored = G.fromHash(new URL(hooks.generatorURL()).hash);
  for (const key of Object.keys(custom)) assert.equal(restored[key], custom[key], key);
  assert.equal(G.themeOf(restored), "custom");
  assert.equal(G.fromHash(""), null);
});

test("contraste: los temas Attego cumplen para texto principal y secundario", () => {
  assert.ok(G.contrast("E6E7E8", "0F0F11") > 15);
  assert.ok(G.contrast("9D7D5D", "0F0F11") >= 4.5);
  assert.ok(G.contrast("9D7D5D", "E6E7E8") < 4.5);
  for (const id of ["attego-dark", "attego-light"]) {
    const theme = G.THEMES[id];
    assert.ok(G.contrast(theme.textPrimaryHex, theme.backgroundHex) >= 7, id);
    assert.ok(G.contrast(theme.textSecondaryHex, theme.backgroundHex) >= 4.5, id);
  }
});

test("la página y el archivo de versión coinciden con el script", () => {
  const version = /WIDGET_VERSION = "([\d.]+)"/.exec(TEMPLATE)[1];
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version, version);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /fetch\("widget\/telcel\.js"/);
  for (const file of ["generator.js", "assets/attego-logotipo-negativo.png", "assets/attego-isotipo.png"]) {
    assert.ok(html.includes(file) && fs.existsSync(path.join(ROOT, file)), file);
  }
});

test("diseños rápidos: Completo, Limpio y Solo la cifra", async () => {
  assert.equal(G.layoutOf({}), "full");
  const clean = G.normalize(G.layoutValues("clean"));
  assert.equal(G.layoutOf(clean), "clean");
  assert.deepEqual([clean.showPlanName, clean.showCarrier, clean.showExpiration, clean.showReadingTime, clean.showRunTime], [false, false, false, false, false]);
  assert.deepEqual([clean.showCaption, clean.showPercent, clean.showNotices], [true, true, true]);
  assert.equal(G.layoutOf({ ...clean, showCaption: false }), "custom");
  const values = vm.runInNewContext(`${G.settingsBlock({ ...G.layoutValues("number"), useSampleData: true })}\nSETTINGS`);
  const { hooks, state } = await loadWidget({ credentials: null, settings: JSON.parse(JSON.stringify(values)) });
  await hooks.main();
  assert.deepEqual(state.texts, ["1.6", "GB"]);
});

test("lo que se oculta viaja en el enlace del widget y los enlaces 1.0.0 siguen sirviendo", async () => {
  const hidden = { showCarrier: false, showExpiration: false, showRunTime: false };
  const { hooks } = await loadWidget({ settings: hidden });
  const restored = G.fromHash(new URL(hooks.generatorURL()).hash);
  for (const key of Object.values(G.SHOW_KEYS)) assert.equal(restored[key], hidden[key] !== false, key);
  const old = G.fromHash("#bg=0F0F11&primary=E6E7E8&secondary=99999B&accent=9D7D5D&chart=bar&corners=square&font=helvetica&plan=false&image=&overlay=0.55");
  assert.equal(old.showPlanName, false);
  assert.equal(old.showCarrier, true);
  assert.equal(old.showRunTime, true);
});
