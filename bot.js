// ============================================
// BRUTAL TEST BOT — Drop Modelo (20 interacciones)
// ============================================

var Telegraf = require(“telegraf”).Telegraf;
var Markup = require(“telegraf”).Markup;
var https = require(“https”);

// — CONFIG —
var BOT_TOKEN = process.env.BOT_TOKEN;
var SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

if (!BOT_TOKEN) { console.error(“ERROR: BOT_TOKEN no definido”); process.exit(1); }

var bot = new Telegraf(BOT_TOKEN);

// — STATE PER USER —
var sessions = {};

function getSession(ctx) {
var id = ctx.from.id;
if (!sessions[id]) {
sessions[id] = {
telegram_id: id,
username: ctx.from.username || ctx.from.first_name || “anon”,
current: -1,
points: 0,
lastSentAt: null,
responses: [],
trapsFailed: 0,
trapsPassed: 0,
started: false,
finished: false,
awaitingText: false,
multiSelectState: null
};
}
return sessions[id];
}

// — LOG TO GOOGLE SHEETS (native https, no node-fetch) —
function logToSheet(data) {
if (!SHEET_WEBHOOK || SHEET_WEBHOOK === “PEGA_ACA_LA_URL_DEL_APPS_SCRIPT”) {
console.log(”[LOG]”, JSON.stringify(data));
return Promise.resolve();
}

return new Promise(function(resolve) {
try {
var postData = JSON.stringify(data);
var urlObj = new URL(SHEET_WEBHOOK);

```
  var options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    }
  };

  var req = https.request(options, function(res) {
    // Follow redirect (Google Apps Script redirects on POST)
    if (res.statusCode === 302 || res.statusCode === 301) {
      var redirectUrl = res.headers.location;
      if (redirectUrl) {
        https.get(redirectUrl, function() { resolve(); }).on("error", function() { resolve(); });
        return;
      }
    }
    res.resume();
    resolve();
  });

  req.on("error", function(err) {
    console.error("Sheet log error:", err.message);
    resolve();
  });

  req.write(postData);
  req.end();
} catch (err) {
  console.error("Sheet log error:", err.message);
  resolve();
}
```

});
}

// — THE 20 INTERACTIONS —
var INTERACTIONS = [
// 1. CULTURE - OPENER
{
id: 1, type: “culture”, name: “opener_moda”,
text: “Sin pensar.\n\nQuien te vende mejor una zapatilla?\nUn pibe de 17 filmandose en el espejo con el outfit — o una modelo profesional con el mismo outfit.”,
options: [
{ text: “El pibe”, data: “pibe” },
{ text: “La modelo”, data: “modelo” }
],
points: 10,
reaction: “++ +10 — Arrancamos.”
},
// 2. NIKE - BRAND 1/2
{
id: 2, type: “brand”, name: “nike_estetica”,
text: “Cual pones en tu story?\n\nA: Campana fondo negro, zapatilla flotando, tipografia minima.\nB: Explosion de color, distorsion, ruido visual.”,
options: [
{ text: “Minimalista”, data: “minimal” },
{ text: “Explosion”, data: “explosion” }
],
points: 10,
reaction: “++ +$0.10”
},
// 3. CULTURE - IDENTIDAD / PROYECCIÓN
{
id: 3, type: “culture”, name: “cultura_genero”,
text: “Pensa en los pibes de tu edad. Hoy ser hombre es mas facil o mas dificil que hace 10 anos?”,
options: [
{ text: “Mas facil”, data: “facil” },
{ text: “Mas dificil”, data: “dificil” },
{ text: “Distinto, no mas facil ni dificil”, data: “distinto” }
],
points: 10,
reaction: “++ +10”
},
// 4. POLÍTICO A - BRAND 1/2
{
id: 4, type: “brand”, name: “politicoA_dolar_proyeccion”,
text: “La mayoria de los pibes de tu edad bancaria una dolarizacion total de la economia?”,
options: [
{ text: “Si, la mayoria banca”, data: “si_mayoria” },
{ text: “No, la mayoria no banca”, data: “no_mayoria” },
{ text: “Les chupa un huevo”, data: “indiferencia” }
],
points: 10,
reaction: “++ +$0.10”
},
// 5. TRAP 1
{
id: 5, type: “trap”, name: “trap_boton_azul”,
text: “TOCA EL BOTON AZUL.”,
options: [
{ text: “ROJO”, data: “rojo” },
{ text: “AZUL”, data: “azul” }
],
correct: “azul”,
pointsWin: 10,
pointsLose: -10,
reactionPass: “Buen ojo. +10 bonus.”,
reactionFail: “Te agarramos en piloto automatico. -10.”
},
// 6. SPOTIFY - BRAND 1/2 (confesionario)
{
id: 6, type: “brand”, name: “spotify_verguenza”,
text: “Una cancion que escuchas en loop pero JAMAS pondrias en una juntada. Escribila.”,
options: “free_text”,
points: 15,
reaction: “Secreto guardado. ++ +$0.15”
},
// 7. CULTURE - RED PILL / BLUE PILL
{
id: 7, type: “culture”, name: “cultura_emigrar”,
text: “Vivir en Argentina ganando bien en pesos.\nVivir afuera ganando lo mismo en dolares.\n\nNo hay tercera opcion.”,
options: [
{ text: “Argentina”, data: “argentina” },
{ text: “Afuera”, data: “afuera” }
],
points: 10,
reaction: “++ +10”
},
// 8. AFA - BRAND 1/2 (multi-select)
{
id: 8, type: “brand”, name: “afa_consumo_futbol”,
text: “Como miras futbol? Elegi TODAS las que aplican. Cuando termines toca LISTO.”,
options: [
{ text: “TV cable”, data: “tv” },
{ text: “Streaming pago”, data: “streaming” },
{ text: “Pirata”, data: “pirata” },
{ text: “En la cancha”, data: “cancha” },
{ text: “Solo clips en redes”, data: “clips” },
{ text: “No miro futbol”, data: “no_miro” }
],
multiSelect: true,
points: 10,
reaction: “++ +$0.10”
},
// 9. POLÍTICO B - BRAND 1/2 (escala Milei)
{
id: 9, type: “brand”, name: “politicoB_milei_escala”,
text: “Milei. Instinto puro. Como te cae hoy?”,
options: [
{ text: “Lo banco fuerte”, data: “5” },
{ text: “Tibio”, data: “4” },
{ text: “Meh”, data: “3” },
{ text: “Cansa”, data: “2” },
{ text: “Harto”, data: “1” }
],
points: 10,
reaction: “++ +$0.10”
},
// 10. CULTURE - HOT TAKE
{
id: 10, type: “culture”, name: “cultura_messi_maradona”,
text: “HOT TAKE. Sin pensar.\n\nMessi es mas grande que Maradona.”,
options: [
{ text: “De acuerdo”, data: “acuerdo” },
{ text: “Ni en pedo”, data: “desacuerdo” }
],
points: 10,
reaction: “++ +10”
},
// 11. MELI - BRAND 1/1
{
id: 11, type: “brand”, name: “meli_precio_inmediatez”,
text: “Pedis algo en MeLi. Llega en 3 dias. Cuanto mas pagarias para que llegue HOY?”,
options: [
{ text: “$0, me espero”, data: “0” },
{ text: “Hasta $500”, data: “500” },
{ text: “$500-$2000”, data: “2000” },
{ text: “Mas de $2000”, data: “2000+” }
],
points: 10,
reaction: “++ +$0.10”
},
// 12. TRAP 2
{
id: 12, type: “trap”, name: “trap_agua_moja”,
text: “Pregunta seria.\n\nEl agua moja?”,
options: [
{ text: “Si”, data: “si” },
{ text: “No”, data: “no” },
{ text: “Depende el agua”, data: “depende” }
],
correct: “si”,
pointsWin: 10,
pointsLose: -5,
reactionPass: “Seguis ahi. +10.”,
reactionFail: “Hmm. -5.”
},
// 13. SPOTIFY - BRAND 2/2
{
id: 13, type: “brand”, name: “spotify_crush”,
text: “Situacion. Tu crush mira tu Spotify. Que playlist preferis que vea?”,
options: [
{ text: “Mi playlist real”, data: “real” },
{ text: “Una armada para impresionar”, data: “armada” }
],
points: 10,
reactionFn: true
},
// 14. POLÍTICO A - BRAND 2/2
{
id: 14, type: “brand”, name: “politicoA_dolar_costo”,
text: “Vuelve el tema. Argentina dolariza. Tu familia gana lo mismo pero tu celu nuevo sale el doble. Seguis bancando?”,
options: [
{ text: “SI, banco”, data: “si” },
{ text: “No, asi no”, data: “no” }
],
points: 10,
reaction: “++ +$0.10”
},
// 15. CULTURE - CONFESIONARIO PROFUNDO
{
id: 15, type: “culture”, name: “cultura_miedo”,
text: “Ultima de este tipo. Sin filtro.\n\nDe que tenes miedo de verdad?”,
options: “free_text”,
points: 20,
reaction: “++ +20 — Gracias por la honestidad.”
},
// 16. NIKE - BRAND 2/2
{
id: 16, type: “brand”, name: “nike_zapatilla_reaccion”,
text: “Imagina: video corto, un pibe caminando, zapatillas en foco, sin logo visible. Tu reaccion:”,
options: [
{ text: “Fuego”, data: “fuego” },
{ text: “Meh”, data: “meh” },
{ text: “Asco”, data: “asco” },
{ text: “Que marca es?”, data: “pregunta” }
],
points: 10,
reaction: “++ +$0.10”
},
// 17. AFA - BRAND 2/2
{
id: 17, type: “brand”, name: “afa_futuro_futbol”,
text: “Modo futurologo. En 5 anos, el futbol argentino se va a ver…”,
options: [
{ text: “Todo streaming”, data: “streaming” },
{ text: “Vuelve la cancha”, data: “cancha” },
{ text: “Muere, gana el gaming”, data: “gaming” }
],
points: 10,
reaction: “++ +$0.10”
},
// 18. POLÍTICO B - BRAND 2/2
{
id: 18, type: “brand”, name: “politicoB_2027”,
text: “Elecciones 2027. Dos opciones. No hay tercera. No hay blanco. No hay nulo.\n\nContinuidad del modelo Milei — o vuelta al kirchnerismo.”,
options: [
{ text: “Continuidad Milei”, data: “milei” },
{ text: “Vuelta K”, data: “kirchnerismo” }
],
points: 10,
reaction: “++ +$0.10”
},
// 19. TRAP 3
{
id: 19, type: “trap”, name: “trap_leer_bien”,
text: “Lee bien antes de tocar.\n\nCuantos meses tiene un ano que tienen 28 dias?”,
options: [
{ text: “1 (febrero)”, data: “1” },
{ text: “Todos”, data: “todos” }
],
correct: “todos”,
pointsWin: 10,
pointsLose: -5,
reactionPass: “Bien. Todos los meses tienen al menos 28. +10.”,
reactionFail: “Lee de nuevo. Todos tienen al menos 28 dias. -5.”
},
// 20. CULTURE - CIERRE
{
id: 20, type: “culture”, name: “cultura_cierre_deseo”,
text: “Ultima. Completa la frase.\n\nSi manana desapareciera de Argentina, nadie extrañaria ___\n\nEscribi lo primero que se te viene.”,
options: “free_text”,
points: 20,
reaction: “++ +20 — Drop completo.”
}
];

// — SEND INTERACTION —
function sendInteraction(ctx, session) {
var idx = session.current;
if (idx >= INTERACTIONS.length) {
return finishDrop(ctx, session);
}

var inter = INTERACTIONS[idx];

// Multi-select
if (inter.multiSelect) {
session.multiSelectState = { selected: {}, messageId: null };
var keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
session.lastSentAt = Date.now();
return ctx.reply(inter.text, keyboard).then(function(msg) {
session.multiSelectState.messageId = msg.message_id;
});
}

// Free text
if (inter.options === “free_text”) {
session.awaitingText = true;
session.lastSentAt = Date.now();
return ctx.reply(inter.text);
}

// Standard inline keyboard
var buttons = [];
for (var i = 0; i < inter.options.length; i++) {
var opt = inter.options[i];
buttons.push(Markup.button.callback(opt.text, “resp_” + idx + “_” + opt.data));
}

var rows = [];
if (buttons.length <= 2) {
rows.push(buttons);
} else if (buttons.length <= 4) {
for (var j = 0; j < buttons.length; j += 2) {
rows.push(buttons.slice(j, j + 2));
}
} else {
for (var k = 0; k < buttons.length; k++) {
rows.push([buttons[k]]);
}
}

var keyboard = Markup.inlineKeyboard(rows);
session.lastSentAt = Date.now();
return ctx.reply(inter.text, keyboard);
}

// — MULTI-SELECT KEYBOARD —
function buildMultiSelectKeyboard(inter, selected) {
var buttons = [];
for (var i = 0; i < inter.options.length; i++) {
var opt = inter.options[i];
var check = selected[opt.data] ? “>> “ : “”;
buttons.push([Markup.button.callback(check + opt.text, “multi_” + opt.data)]);
}
buttons.push([Markup.button.callback(”– LISTO –”, “multi_done”)]);
return Markup.inlineKeyboard(buttons);
}

// — PROCESS RESPONSE —
function processResponse(ctx, session, responseData) {
var idx = session.current;
var inter = INTERACTIONS[idx];
var latency = session.lastSentAt ? Date.now() - session.lastSentAt : 0;

var points = inter.points || 0;
var trapResult = “”;

if (inter.type === “trap”) {
if (responseData === inter.correct) {
points = inter.pointsWin;
trapResult = “PASS”;
session.trapsPassed++;
} else {
points = inter.pointsLose;
trapResult = “FAIL”;
session.trapsFailed++;
}
}

session.points += points;
if (session.points < 0) session.points = 0;

// Log
logToSheet({
timestamp: new Date().toISOString(),
telegram_id: session.telegram_id,
username: session.username,
interaction_num: inter.id,
interaction_type: inter.type,
interaction_name: inter.name,
response: responseData,
latency_ms: latency,
cumulative_points: session.points,
trap_result: trapResult,
completed_drop: “”
});

// Reaction
var reaction;
if (inter.type === “trap”) {
reaction = trapResult === “PASS” ? inter.reactionPass : inter.reactionFail;
} else if (inter.reactionFn) {
reaction = responseData === “real” ? “++ +$0.10 — Seguro que si.” : “++ +$0.10 — Honestidad brutal.”;
} else {
reaction = inter.reaction;
}

var pointsDisplay = “\n\n” + session.points + “ puntos totales”;

return ctx.reply(reaction + pointsDisplay).then(function() {
return new Promise(function(resolve) { setTimeout(resolve, 600); });
}).then(function() {
session.current++;
return sendInteraction(ctx, session);
});
}

// — FINISH DROP —
function finishDrop(ctx, session) {
session.finished = true;

var total = session.trapsPassed + session.trapsFailed;
var trapScore = total > 0 ? Math.round((session.trapsPassed / total) * 100) : 100;

var summary = “DROP COMPLETO\n\n” +
“Puntos finales: “ + session.points + “\n” +
“Traps: “ + session.trapsPassed + “/” + total + “ correctas (” + trapScore + “%)\n” +
INTERACTIONS.length + “ interacciones completadas\n\n” +
“Gracias. Tu senal fue registrada. Nadie sabe que respondiste.”;

logToSheet({
timestamp: new Date().toISOString(),
telegram_id: session.telegram_id,
username: session.username,
interaction_num: 0,
interaction_type: “system”,
interaction_name: “drop_completed”,
response: “points:” + session.points + “_traps:” + trapScore + “%”,
latency_ms: 0,
cumulative_points: session.points,
trap_result: session.trapsPassed + “/” + total,
completed_drop: “YES”
});

return ctx.reply(summary);
}

// — HANDLERS —

bot.start(function(ctx) {
var session = getSession(ctx);

if (session.finished) {
return ctx.reply(“Ya completaste el Drop. Gracias por participar.”);
}
if (session.started) {
return ctx.reply(“Ya arrancaste. Segui respondiendo.”);
}

return ctx.reply(
“BRUTAL\n\nLlego el Drop. 20 preguntas. 3-5 minutos.\nResponde rapido, nadie ve tus respuestas.\nCada una suma puntos.\nSi te agarramos en piloto automatico, restas.\n\nArrancamos?”,
Markup.inlineKeyboard([
[Markup.button.callback(“Dale”, “start_drop”)],
[Markup.button.callback(“Despues”, “later”)]
])
);
});

bot.action(“start_drop”, function(ctx) {
return ctx.answerCbQuery().then(function() {
var session = getSession(ctx);
if (session.started) return;

```
session.started = true;
session.current = 0;

logToSheet({
  timestamp: new Date().toISOString(),
  telegram_id: session.telegram_id,
  username: session.username,
  interaction_num: 0,
  interaction_type: "system",
  interaction_name: "drop_started",
  response: "START",
  latency_ms: 0,
  cumulative_points: 0,
  trap_result: "",
  completed_drop: ""
});

return ctx.reply("Vamos.").then(function() {
  return new Promise(function(resolve) { setTimeout(resolve, 500); });
}).then(function() {
  return sendInteraction(ctx, session);
});
```

});
});

bot.action(“later”, function(ctx) {
return ctx.answerCbQuery().then(function() {
return ctx.reply(“Ok. Cuando quieras, manda /start.”);
});
});

// Standard button responses
bot.action(/^resp_(\d+)_(.+)$/, function(ctx) {
return ctx.answerCbQuery().then(function() {
var session = getSession(ctx);
if (session.finished) return;

```
var actionIdx = parseInt(ctx.match[1]);
var responseData = ctx.match[2];

if (actionIdx !== session.current) return;

return processResponse(ctx, session, responseData);
```

});
});

// Multi-select toggles
bot.action(/^multi_(.+)$/, function(ctx) {
return ctx.answerCbQuery().then(function() {
var session = getSession(ctx);
if (session.finished) return;
if (!session.multiSelectState) return;

```
var value = ctx.match[1];
var inter = INTERACTIONS[session.current];

if (value === "done") {
  var selected = Object.keys(session.multiSelectState.selected);
  if (selected.length === 0) {
    return ctx.reply("Toca al menos una opcion antes de LISTO.");
  }
  var responseData = selected.join(",");
  session.multiSelectState = null;
  return processResponse(ctx, session, responseData);
}

// Toggle
if (session.multiSelectState.selected[value]) {
  delete session.multiSelectState.selected[value];
} else {
  session.multiSelectState.selected[value] = true;
}

try {
  var keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
  return ctx.editMessageReplyMarkup(keyboard.reply_markup);
} catch (e) {
  // ignore
}
```

});
});

// Free text
bot.on(“text”, function(ctx) {
var session = getSession(ctx);
if (!session.started || session.finished) return;
if (!session.awaitingText) return;

session.awaitingText = false;
var text = ctx.message.text.substring(0, 500);
return processResponse(ctx, session, text);
});

// /reset
bot.command(“reset”, function(ctx) {
var id = ctx.from.id;
delete sessions[id];
return ctx.reply(“Session reseteada. Manda /start para arrancar de nuevo.”);
});

// /status
bot.command(“status”, function(ctx) {
var session = getSession(ctx);
if (!session.started) return ctx.reply(“No arrancaste todavia. Manda /start.”);
if (session.finished) return ctx.reply(“Drop completado. “ + session.points + “ puntos.”);
var current = session.current + 1;
return ctx.reply(“Interaccion “ + current + “/” + INTERACTIONS.length + “. “ + session.points + “ puntos.”);
});

// — LAUNCH —
bot.launch().then(function() {
console.log(“BRUTAL Bot arranco. Esperando nodos…”);
});

process.once(“SIGINT”, function() { bot.stop(“SIGINT”); });
process.once(“SIGTERM”, function() { bot.stop(“SIGTERM”); });
