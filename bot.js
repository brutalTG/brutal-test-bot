// ============================================
// BRUTAL TEST BOT — Drop Modelo (20 interacciones)
// ============================================
// Test rústico. Sin Supabase, sin Mini App, sin agentes AI.
// Solo bot + Google Sheets como base de datos.
// Objetivo: validar si la mecánica funciona y la gente completa.

const { Telegraf, Markup } = require(“telegraf”);
const fetch = require(“node-fetch”);

// — CONFIG —
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

if (!BOT_TOKEN) { console.error(“ERROR: BOT_TOKEN no definido”); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// — STATE PER USER —
// In-memory state. Dies when bot restarts. Fine for 30 users.
const sessions = {};

function getSession(ctx) {
const id = ctx.from.id;
if (!sessions[id]) {
sessions[id] = {
telegram_id: id,
username: ctx.from.username || ctx.from.first_name || “anon”,
current: -1, // -1 = not started
points: 0,
lastSentAt: null,
responses: [],
trapsFailed: 0,
trapsPassed: 0,
started: false,
finished: false,
};
}
return sessions[id];
}

// — LOG TO GOOGLE SHEETS —
async function logToSheet(data) {
if (!SHEET_WEBHOOK || SHEET_WEBHOOK === “PEGA_ACA_LA_URL_DEL_APPS_SCRIPT”) {
console.log(”[LOG]”, JSON.stringify(data));
return;
}
try {
await fetch(SHEET_WEBHOOK, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify(data),
});
} catch (err) {
console.error(“Sheet log error:”, err.message);
}
}

// — THE 20 INTERACTIONS —
// Each interaction: { id, type, name, text, options[], correct (for traps), pointsWin, pointsLose, botReaction }

const INTERACTIONS = [
// 1. CULTURE - OPENER
{
id: 1, type: “culture”, name: “opener_moda”,
text: “Sin pensar.\n\n¿Quién te vende mejor una zapatilla?\nUn pibe de 17 filmándose en el espejo con el outfit — o una modelo profesional con el mismo outfit.”,
options: [
{ text: “👤 El pibe”, data: “pibe” },
{ text: “💎 La modelo”, data: “modelo” },
],
points: 10,
reaction: “⚡ +10 — Arrancamos.”,
},
// 2. NIKE - BRAND 1/2
{
id: 2, type: “brand”, name: “nike_estetica”,
text: “¿Cuál ponés en tu story?\n\nA: Campaña fondo negro, zapatilla flotando, tipografía mínima.\nB: Explosión de color, distorsión, ruido visual.”,
options: [
{ text: “🖤 Minimalista”, data: “minimal” },
{ text: “🌈 Explosión”, data: “explosion” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 3. CULTURE - IDENTIDAD / PROYECCIÓN
{
id: 3, type: “culture”, name: “cultura_genero”,
text: “Pensá en los pibes de tu edad. ¿Hoy ser hombre es más fácil o más difícil que hace 10 años?”,
options: [
{ text: “Más fácil”, data: “facil” },
{ text: “Más difícil”, data: “dificil” },
{ text: “Distinto, no más fácil ni difícil”, data: “distinto” },
],
points: 10,
reaction: “⚡ +10”,
},
// 4. POLÍTICO A - BRAND 1/2 (dolarización proyección)
{
id: 4, type: “brand”, name: “politicoA_dolar_proyeccion”,
text: “¿La mayoría de los pibes de tu edad bancaría una dolarización total de la economía?”,
options: [
{ text: “Sí, la mayoría banca”, data: “si_mayoria” },
{ text: “No, la mayoría no banca”, data: “no_mayoria” },
{ text: “Les chupa un huevo”, data: “indiferencia” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 5. TRAP 1 - INSTRUCCIÓN CONTRADICTORIA
{
id: 5, type: “trap”, name: “trap_boton_azul”,
text: “⚠️ TOCÁ EL BOTÓN AZUL.”,
options: [
{ text: “🔴 ROJO”, data: “rojo” },
{ text: “🔵 AZUL”, data: “azul” },
],
correct: “azul”,
pointsWin: 10,
pointsLose: -10,
reactionPass: “✅ Buen ojo. +10 bonus.”,
reactionFail: “👁 Te agarramos en piloto automático. -10.”,
},
// 6. SPOTIFY - BRAND 1/2 (confesionario)
{
id: 6, type: “brand”, name: “spotify_verguenza”,
text: “Una canción que escuchás en loop pero JAMÁS pondrías en una juntada. Escribila.”,
options: “free_text”,
points: 15,
reaction: “🤫 Secreto guardado. ⚡ +$0.15”,
},
// 7. CULTURE - RED PILL / BLUE PILL
{
id: 7, type: “culture”, name: “cultura_emigrar”,
text: “🔵 Vivir en Argentina ganando bien en pesos.\n🔴 Vivir afuera ganando lo mismo en dólares.\n\nNo hay tercera opción.”,
options: [
{ text: “🔵 Argentina”, data: “argentina” },
{ text: “🔴 Afuera”, data: “afuera” },
],
points: 10,
reaction: “⚡ +10”,
},
// 8. AFA - BRAND 1/2 (multi-select)
{
id: 8, type: “brand”, name: “afa_consumo_futbol”,
text: “¿Cómo mirás fútbol? Elegí TODAS las que aplican. Cuando termines tocá LISTO.”,
options: [
{ text: “📺 TV cable”, data: “tv” },
{ text: “📱 Streaming pago”, data: “streaming” },
{ text: “🏴‍☠️ Pirata”, data: “pirata” },
{ text: “🏟 En la cancha”, data: “cancha” },
{ text: “🐦 Solo clips en redes”, data: “clips” },
{ text: “⚽ No miro fútbol”, data: “no_miro” },
],
multiSelect: true,
points: 10,
reaction: “⚡ +$0.10”,
},
// 9. POLÍTICO B - BRAND 1/2 (escala Milei)
{
id: 9, type: “brand”, name: “politicoB_milei_escala”,
text: “Milei. Instinto puro. ¿Cómo te cae hoy?”,
options: [
{ text: “🟢🟢 Lo banco”, data: “5” },
{ text: “🟢 Tibio”, data: “4” },
{ text: “⚪ Meh”, data: “3” },
{ text: “🔴 Cansa”, data: “2” },
{ text: “🔴🔴 Harto”, data: “1” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 10. CULTURE - HOT TAKE
{
id: 10, type: “culture”, name: “cultura_messi_maradona”,
text: “HOT TAKE. Sin pensar.\n\n*Messi es más grande que Maradona.*”,
options: [
{ text: “✅ De acuerdo”, data: “acuerdo” },
{ text: “❌ Ni en pedo”, data: “desacuerdo” },
],
points: 10,
reaction: “⚡ +10 💯”,
},
// 11. MELI - BRAND 1/1 (precio inmediatez)
{
id: 11, type: “brand”, name: “meli_precio_inmediatez”,
text: “Pedís algo en MeLi. Llega en 3 días. ¿Cuánto más pagarías para que llegue HOY?”,
options: [
{ text: “$0, me espero”, data: “0” },
{ text: “Hasta $500”, data: “500” },
{ text: “$500-$2000”, data: “2000” },
{ text: “Más de $2000”, data: “2000+” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 12. TRAP 2 - PREGUNTA ABSURDA
{
id: 12, type: “trap”, name: “trap_agua_moja”,
text: “Pregunta seria.\n\n¿El agua moja?”,
options: [
{ text: “Sí”, data: “si” },
{ text: “No”, data: “no” },
{ text: “Depende el agua”, data: “depende” },
],
correct: “si”,
pointsWin: 10,
pointsLose: -5,
reactionPass: “✅ Seguís ahí. +10.”,
reactionFail: “👁 Hmm. -5.”,
},
// 13. SPOTIFY - BRAND 2/2 (crush playlist)
{
id: 13, type: “brand”, name: “spotify_crush”,
text: “Situación. Tu crush mira tu Spotify. ¿Qué playlist preferís que vea?”,
options: [
{ text: “🎵 Mi playlist real”, data: “real” },
{ text: “✨ Una armada para impresionar”, data: “armada” },
],
points: 10,
reaction: (resp) => resp === “real” ? “⚡ +$0.10 — Seguro que sí.” : “⚡ +$0.10 — Honestidad brutal.”,
},
// 14. POLÍTICO A - BRAND 2/2 (dolarización con costo)
{
id: 14, type: “brand”, name: “politicoA_dolar_costo”,
text: “Vuelve el tema. Argentina dolariza. Tu familia gana lo mismo pero tu celu nuevo sale el doble. ¿Seguís bancando?”,
options: [
{ text: “SÍ, banco”, data: “si” },
{ text: “No, así no”, data: “no” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 15. CULTURE - CONFESIONARIO PROFUNDO
{
id: 15, type: “culture”, name: “cultura_miedo”,
text: “Última de este tipo. Sin filtro.\n\n¿De qué tenés miedo de verdad?”,
options: “free_text”,
points: 20,
reaction: “⚡ +20 — Gracias por la honestidad.”,
},
// 16. NIKE - BRAND 2/2 (video reaction)
{
id: 16, type: “brand”, name: “nike_zapatilla_reaccion”,
text: “Imaginá: video corto, un pibe caminando, zapatillas en foco, sin logo visible. Tu reacción:”,
options: [
{ text: “🔥”, data: “fuego” },
{ text: “😐”, data: “meh” },
{ text: “🤮”, data: “asco” },
{ text: “❓ ¿Qué marca es?”, data: “pregunta” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 17. AFA - BRAND 2/2 (predicción fútbol)
{
id: 17, type: “brand”, name: “afa_futuro_futbol”,
text: “Modo futurólogo. En 5 años, ¿el fútbol argentino se va a ver…”,
options: [
{ text: “📱 Todo streaming”, data: “streaming” },
{ text: “🏟 Vuelve la cancha”, data: “cancha” },
{ text: “🎮 Muere, gana el gaming”, data: “gaming” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 18. POLÍTICO B - BRAND 2/2 (forced choice 2027)
{
id: 18, type: “brand”, name: “politicoB_2027”,
text: “Elecciones 2027. Dos opciones. No hay tercera. No hay blanco. No hay nulo.\n\nContinuidad del modelo Milei — o vuelta al kirchnerismo.”,
options: [
{ text: “Continuidad Milei”, data: “milei” },
{ text: “Vuelta K”, data: “kirchnerismo” },
],
points: 10,
reaction: “⚡ +$0.10”,
},
// 19. TRAP 3 - LEER BIEN
{
id: 19, type: “trap”, name: “trap_leer_bien”,
text: “Leé bien antes de tocar.\n\n¿Cuántos meses tiene un año que tienen 28 días?”,
options: [
{ text: “1 (febrero)”, data: “1” },
{ text: “Todos”, data: “todos” },
],
correct: “todos”,
pointsWin: 10,
pointsLose: -5,
reactionPass: “✅ Bien. Todos los meses tienen al menos 28. +10.”,
reactionFail: “👁 Leé de nuevo. Todos tienen al menos 28 días. -5.”,
},
// 20. CULTURE - CIERRE EMOCIONAL
{
id: 20, type: “culture”, name: “cultura_cierre_deseo”,
text: “Última. Completá la frase.\n\nSi mañana desapareciera de Argentina, nadie extrañaría ___\n\nEscribí lo primero que se te viene.”,
options: “free_text”,
points: 20,
reaction: “⚡ +20 — Drop completo.”,
},
];

// — SEND INTERACTION —
async function sendInteraction(ctx, session) {
const idx = session.current;
if (idx >= INTERACTIONS.length) {
return finishDrop(ctx, session);
}

const inter = INTERACTIONS[idx];

// Multi-select needs special handling
if (inter.multiSelect) {
session.multiSelectState = { selected: new Set(), messageId: null, sentAt: Date.now() };
const keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
const msg = await ctx.reply(inter.text, keyboard);
session.multiSelectState.messageId = msg.message_id;
session.lastSentAt = Date.now();
return;
}

if (inter.options === “free_text”) {
session.awaitingText = true;
session.lastSentAt = Date.now();
await ctx.reply(inter.text);
return;
}

// Standard inline keyboard
const buttons = inter.options.map((opt) =>
Markup.button.callback(opt.text, `resp_${idx}_${opt.data}`)
);

// Arrange buttons: max 2 per row for binary, otherwise stack
let keyboard;
if (buttons.length <= 2) {
keyboard = Markup.inlineKeyboard([buttons]);
} else if (buttons.length <= 4) {
const rows = [];
for (let i = 0; i < buttons.length; i += 2) {
rows.push(buttons.slice(i, i + 2));
}
keyboard = Markup.inlineKeyboard(rows);
} else {
keyboard = Markup.inlineKeyboard(buttons.map((b) => [b]));
}

session.lastSentAt = Date.now();
await ctx.reply(inter.text, { …keyboard, parse_mode: “Markdown” });
}

// — MULTI-SELECT KEYBOARD —
function buildMultiSelectKeyboard(inter, selected) {
const buttons = inter.options.map((opt) => {
const check = selected.has(opt.data) ? “✅ “ : “”;
return [Markup.button.callback(`${check}${opt.text}`, `multi_${opt.data}`)];
});
buttons.push([Markup.button.callback(“✔️ LISTO”, “multi_done”)]);
return Markup.inlineKeyboard(buttons);
}

// — PROCESS RESPONSE —
async function processResponse(ctx, session, responseData) {
const idx = session.current;
const inter = INTERACTIONS[idx];
const latency = session.lastSentAt ? Date.now() - session.lastSentAt : 0;

let points = inter.points || 0;
let trapResult = “”;

// Handle trap
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

// Log to sheet
await logToSheet({
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
completed_drop: “”,
});

// Send reaction
let reaction;
if (inter.type === “trap”) {
reaction = trapResult === “PASS” ? inter.reactionPass : inter.reactionFail;
} else if (typeof inter.reaction === “function”) {
reaction = inter.reaction(responseData);
} else {
reaction = inter.reaction;
}

const pointsDisplay = `\n\n📊 ${session.points} puntos totales`;
await ctx.reply(reaction + pointsDisplay);

// Small delay to feel like conversation
await sleep(600);

// Advance
session.current++;
await sendInteraction(ctx, session);
}

// — FINISH DROP —
async function finishDrop(ctx, session) {
session.finished = true;

const trapScore = session.trapsPassed + session.trapsFailed > 0
? Math.round((session.trapsPassed / (session.trapsPassed + session.trapsFailed)) * 100)
: 100;

const summary = `🏁 *DROP COMPLETO*

📊 Puntos finales: ${session.points}
✅ Traps: ${session.trapsPassed}/${session.trapsPassed + session.trapsFailed} correctas (${trapScore}%)
⏱ ${INTERACTIONS.length} interacciones completadas

Gracias. Tu señal fue registrada. Nadie sabe qué respondiste.`;

await ctx.reply(summary, { parse_mode: “Markdown” });

// Log completion
await logToSheet({
timestamp: new Date().toISOString(),
telegram_id: session.telegram_id,
username: session.username,
interaction_num: 0,
interaction_type: “system”,
interaction_name: “drop_completed”,
response: `points:${session.points}_traps:${trapScore}%`,
latency_ms: 0,
cumulative_points: session.points,
trap_result: `${session.trapsPassed}/${session.trapsPassed + session.trapsFailed}`,
completed_drop: “YES”,
});
}

// — UTILITY —
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// — HANDLERS —

// /start
bot.start(async (ctx) => {
const session = getSession(ctx);

if (session.finished) {
return ctx.reply(“Ya completaste el Drop. Gracias por participar.”);
}
if (session.started) {
return ctx.reply(“Ya arrancaste. Seguí respondiendo.”);
}

await ctx.reply(
“🤖 *BRUTAL*\n\nLlegó el Drop. 20 preguntas. 3-5 minutos.\nRespondé rápido, nadie ve tus respuestas.\nCada una suma puntos.\nSi te agarramos en piloto automático, restás.\n\n¿Arrancamos?”,
{
parse_mode: “Markdown”,
…Markup.inlineKeyboard([
[Markup.button.callback(“🚀 Dale”, “start_drop”)],
[Markup.button.callback(“⏰ Después”, “later”)],
]),
}
);
});

// Start drop
bot.action(“start_drop”, async (ctx) => {
await ctx.answerCbQuery();
const session = getSession(ctx);
if (session.started) return;

session.started = true;
session.current = 0;

// Log start
await logToSheet({
timestamp: new Date().toISOString(),
telegram_id: session.telegram_id,
username: session.username,
interaction_num: 0,
interaction_type: “system”,
interaction_name: “drop_started”,
response: “START”,
latency_ms: 0,
cumulative_points: 0,
trap_result: “”,
completed_drop: “”,
});

await ctx.reply(“Vamos. 🔥”);
await sleep(500);
await sendInteraction(ctx, session);
});

bot.action(“later”, async (ctx) => {
await ctx.answerCbQuery();
await ctx.reply(“Ok. Cuando quieras, mandá /start.”);
});

// Handle standard button responses
bot.action(/^resp_(\d+)_(.+)$/, async (ctx) => {
await ctx.answerCbQuery();
const session = getSession(ctx);
if (session.finished) return;

const actionIdx = parseInt(ctx.match[1]);
const responseData = ctx.match[2];

// Only process if this is the current interaction (prevent double-tap)
if (actionIdx !== session.current) return;

await processResponse(ctx, session, responseData);
});

// Handle multi-select toggles
bot.action(/^multi_(.+)$/, async (ctx) => {
await ctx.answerCbQuery();
const session = getSession(ctx);
if (session.finished) return;
if (!session.multiSelectState) return;

const value = ctx.match[1];
const inter = INTERACTIONS[session.current];

if (value === “done”) {
// Submit multi-select
const selected = Array.from(session.multiSelectState.selected);
if (selected.length === 0) {
return ctx.reply(“Tocá al menos una opción antes de LISTO.”);
}
const responseData = selected.join(”,”);
session.multiSelectState = null;
await processResponse(ctx, session, responseData);
return;
}

// Toggle selection
if (session.multiSelectState.selected.has(value)) {
session.multiSelectState.selected.delete(value);
} else {
session.multiSelectState.selected.add(value);
}

// Update keyboard
try {
const keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
await ctx.editMessageReplyMarkup(keyboard.reply_markup);
} catch (e) {
// Ignore if message hasn’t changed
}
});

// Handle free text responses
bot.on(“text”, async (ctx) => {
const session = getSession(ctx);
if (!session.started || session.finished) return;
if (!session.awaitingText) return;

session.awaitingText = false;
const text = ctx.message.text.substring(0, 500); // limit length
await processResponse(ctx, session, text);
});

// /reset (for testing)
bot.command(“reset”, async (ctx) => {
const id = ctx.from.id;
delete sessions[id];
await ctx.reply(“Session reseteada. Mandá /start para arrancar de nuevo.”);
});

// /status
bot.command(“status”, async (ctx) => {
const session = getSession(ctx);
if (!session.started) return ctx.reply(“No arrancaste todavía. Mandá /start.”);
if (session.finished) return ctx.reply(`Drop completado. ${session.points} puntos.`);
const current = session.current + 1;
return ctx.reply(`Interacción ${current}/${INTERACTIONS.length}. ${session.points} puntos.`);
});

// — LAUNCH —
bot.launch().then(() => {
console.log(“🤖 BRUTAL Bot arrancó. Esperando nodos…”);
});

process.once(“SIGINT”, () => bot.stop(“SIGINT”));
process.once(“SIGTERM”, () => bot.stop(“SIGTERM”));
