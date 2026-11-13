// Lógica compartida por el generador (index.html) y las pruebas.
// Convierte las opciones elegidas en el bloque SETTINGS del script de Scriptable.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TelcelWidgetGenerator = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const THEMES = {
    "attego-dark": {
      label: "Attego oscuro",
      backgroundHex: "0F0F11", textPrimaryHex: "E6E7E8", textSecondaryHex: "99999B", accentHex: "9D7D5D",
      barCorners: "square", font: "helvetica",
    },
    "attego-light": {
      label: "Attego claro",
      backgroundHex: "E6E7E8", textPrimaryHex: "0F0F11", textSecondaryHex: "545456", accentHex: "9D7D5D",
      barCorners: "square", font: "helvetica",
    },
    classic: {
      label: "Clásico rojo",
      backgroundHex: "101012", textPrimaryHex: "FFFFFF", textSecondaryHex: "929298", accentHex: "FF453A",
      barCorners: "round", font: "system",
    },
  };

  const DEFAULTS = {
    ...pick(THEMES["attego-dark"]),
    chartStyle: "bar",
    showPlanName: true, showCarrier: true, showCaption: true, showPercent: true,
    showExpiration: true, showReadingTime: true, showRunTime: true, showNotices: true,
    backgroundImageUrl: "",
    backgroundOverlayOpacity: 0.55,
    cacheMinutes: 30,
    retryMinutes: 15,
    requestTimeoutSeconds: 20,
    debug: false,
    useSampleData: false,
    sampleState: "success",
  };

  function pick(theme) {
    const { label, ...values } = theme;
    return values;
  }

  function hex(value, fallback) {
    return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())
      ? value.trim().replace(/^#/, "").toUpperCase() : fallback;
  }

  // Nombre corto en el enlace del widget → opción del script.
  const SHOW_KEYS = { plan: "showPlanName", carrier: "showCarrier", caption: "showCaption", percent: "showPercent",
    expires: "showExpiration", reading: "showReadingTime", run: "showRunTime", notices: "showNotices" };

  // Diseños rápidos: qué elementos se ven.
  const LAYOUTS = {
    full: { label: "Completo", show: Object.keys(SHOW_KEYS) },
    clean: { label: "Limpio", show: ["caption", "percent", "notices"] },
    number: { label: "Solo la cifra", show: ["notices"] },
  };

  function layoutValues(id) {
    return Object.fromEntries(Object.entries(SHOW_KEYS).map(([name, key]) => [key, LAYOUTS[id].show.includes(name)]));
  }

  function shown(value) {
    return value !== false && value !== "false";
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function number(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  // Solo se aceptan imágenes https, sin comillas ni saltos de línea que rompan el script.
  function imageUrl(value) {
    const url = typeof value === "string" ? value.trim() : "";
    return /^https:\/\/[^\s"'\\<>`]+$/i.test(url) && url.length <= 2000 ? url : "";
  }

  // Limpia cualquier entrada (formulario o enlace) y devuelve opciones seguras y completas.
  function normalize(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      backgroundHex: hex(source.backgroundHex, DEFAULTS.backgroundHex),
      textPrimaryHex: hex(source.textPrimaryHex, DEFAULTS.textPrimaryHex),
      textSecondaryHex: hex(source.textSecondaryHex, DEFAULTS.textSecondaryHex),
      accentHex: hex(source.accentHex, DEFAULTS.accentHex),
      chartStyle: oneOf(source.chartStyle, ["bar", "arc", "none"], DEFAULTS.chartStyle),
      barCorners: oneOf(source.barCorners, ["square", "round"], DEFAULTS.barCorners),
      font: oneOf(source.font, ["helvetica", "system"], DEFAULTS.font),
      ...Object.fromEntries(Object.values(SHOW_KEYS).map(key => [key, shown(source[key])])),
      backgroundImageUrl: imageUrl(source.backgroundImageUrl),
      backgroundOverlayOpacity: Math.round(number(source.backgroundOverlayOpacity, 0, 1, DEFAULTS.backgroundOverlayOpacity) * 100) / 100,
      cacheMinutes: Math.round(number(source.cacheMinutes, 15, 720, DEFAULTS.cacheMinutes)),
      retryMinutes: DEFAULTS.retryMinutes,
      requestTimeoutSeconds: DEFAULTS.requestTimeoutSeconds,
      debug: source.debug === true,
      useSampleData: source.useSampleData === true,
      sampleState: oneOf(source.sampleState, ["success", "stale", "error", "setup", "update"], DEFAULTS.sampleState),
    };
  }

  function themeOf(settings) {
    const s = normalize(settings);
    const keys = ["backgroundHex", "textPrimaryHex", "textSecondaryHex", "accentHex", "barCorners", "font"];
    return Object.keys(THEMES).find(id => keys.every(key => THEMES[id][key] === s[key])) || "custom";
  }

  function layoutOf(settings) {
    const s = normalize(settings);
    return Object.keys(LAYOUTS).find(id => Object.entries(layoutValues(id)).every(([key, value]) => s[key] === value)) || "custom";
  }

  const COMMENTS = {
    backgroundHex: "Fondo.",
    textPrimaryHex: "Cifra y nombre del plan.",
    textSecondaryHex: "Detalles y pista de la gráfica.",
    accentHex: "Gráfica y rótulo TELCEL.",
    chartStyle: "bar, arc (semicírculo) o none.",
    barCorners: "square (recto) o round.",
    font: "helvetica o system (San Francisco).",
    showPlanName: "Nombre del plan, arriba.",
    showCarrier: "Rótulo TELCEL, arriba.",
    showCaption: "\"disponibles de 7.0 GB\".",
    showPercent: "\"77% utilizado\".",
    showExpiration: "\"Vence 24 oct · en 5 días\".",
    showReadingTime: "\"Dato de Telcel · fecha y hora\".",
    showRunTime: "\"Revisado · fecha y hora\".",
    showNotices: "Avisos de fallo y de nueva versión.",
    backgroundImageUrl: "Opcional: URL https de una imagen de fondo.",
    backgroundOverlayOpacity: "0 a 1. Capa del color de fondo sobre la imagen.",
    cacheMinutes: "Minutos que se reutiliza la última lectura.",
    retryMinutes: "Espera después de un fallo.",
    requestTimeoutSeconds: "",
    debug: "Registro seguro en la consola de Scriptable.",
    useSampleData: "true muestra datos de ejemplo sin consultar a Telcel.",
    sampleState: "success, stale, error, setup, update.",
  };

  function settingsBlock(settings) {
    const s = normalize(settings);
    const lines = Object.keys(COMMENTS).map(key => {
      const comment = COMMENTS[key] ? ` // ${COMMENTS[key]}` : "";
      return `  ${key}: ${JSON.stringify(s[key])},${comment}`;
    });
    return `// <SETTINGS>\nconst SETTINGS = {\n${lines.join("\n")}\n};\n// </SETTINGS>`;
  }

  // Sustituye el bloque SETTINGS del script original por el generado.
  function buildScript(template, settings) {
    const pattern = /\/\/ <SETTINGS>[\s\S]*?\/\/ <\/SETTINGS>/;
    if (typeof template !== "string" || !pattern.test(template)) throw new Error("El script base no tiene el bloque SETTINGS.");
    return template.replace(pattern, () => settingsBlock(settings));
  }

  // Lee la apariencia que el widget manda en el enlace (#bg=...&accent=...).
  function fromHash(hash) {
    const values = {};
    for (const pair of String(hash || "").replace(/^#/, "").split("&")) {
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      try { values[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1)); } catch { /* Par ilegible: se ignora. */ }
    }
    if (!Object.keys(values).length) return null;
    // Los widgets 1.0.0 solo mandan "plan"; desde 1.1.0 mandan la lista "show".
    const visible = values.show === undefined ? { showPlanName: values.plan }
      : Object.fromEntries(Object.entries(SHOW_KEYS).map(([name, key]) => [key, values.show.split(",").includes(name)]));
    return normalize({
      ...visible,
      backgroundHex: values.bg, textPrimaryHex: values.primary, textSecondaryHex: values.secondary,
      accentHex: values.accent, chartStyle: values.chart, barCorners: values.corners, font: values.font,
      backgroundImageUrl: values.image, backgroundOverlayOpacity: values.overlay,
    });
  }

  function luminance(hexColor) {
    const channel = index => {
      const value = parseInt(hexColor.slice(index, index + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  }

  // Contraste WCAG entre dos colores hex de seis dígitos (1 a 21).
  function contrast(a, b) {
    const la = luminance(hex(a, "000000")), lb = luminance(hex(b, "000000"));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  return { THEMES, LAYOUTS, SHOW_KEYS, layoutValues, layoutOf, DEFAULTS, normalize, themeOf, settingsBlock, buildScript, fromHash, contrast, themeValues: id => pick(THEMES[id]) };
});
