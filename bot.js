var Telegraf = require("telegraf").Telegraf;
var Markup = require("telegraf").Markup;
var https = require("https");
var fs = require("fs");

var BOT_TOKEN = process.env.BOT_TOKEN;
var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_KEY;
var LOG_CHANNEL = process.env.LOG_CHANNEL || "";

if (!BOT_TOKEN) { console.error("ERROR: BOT_TOKEN no definido"); process.exit(1); }
if (!SUPABASE_URL) { console.error("ERROR: SUPABASE_URL no definido"); process.exit(1); }
if (!SUPABASE_KEY) { console.error("ERROR: SUPABASE_KEY no definido"); process.exit(1); }

var bot = new Telegraf(BOT_TOKEN);

var sessions = {};

function getSession(ctx) {
  var id = ctx.from.id;
  if (!sessions[id]) {
    sessions[id] = {
      telegram_id: id,
      username: ctx.from.username || ctx.from.first_name || "anon",
      current: -1,
      points: 0,
      lastSentAt: null,
      responses: [],
      trapsFailed: 0,
      trapsPassed: 0,
      started: false,
      finished: false,
      awaitingText: false,
      awaitingMedia: false,
      multiSelectState: null,
      drop_id: null,
      anonymous_id: null
    };
  }
  return sessions[id];
}

// ─── SUPABASE HELPERS ───────────────────────────────────────────────

function supabaseRequest(method, path, body, callback) {
  var postData = body ? JSON.stringify(body) : null;
  var urlParts = new URL(SUPABASE_URL + path);
  var options = {
    hostname: urlParts.hostname,
    path: urlParts.pathname + (urlParts.search || ""),
    method: method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : ""
    }
  };
  if (postData) {
    options.headers["Content-Length"] = Buffer.byteLength(postData);
  }

  var req = https.request(options, function(res) {
    var data = "";
    res.on("data", function(chunk) { data += chunk; });
    res.on("end", function() {
      try {
        var parsed = JSON.parse(data);
        callback(null, parsed);
      } catch(e) {
        callback(null, data);
      }
    });
  });
  req.on("error", function(err) {
    console.error("Supabase request error:", err.message);
    callback(err, null);
  });
  if (postData) req.write(postData);
  req.end();
}

function getOrCreateUser(telegramId, username, callback) {
  var searchPath = "/rest/v1/users?telegram_id=eq." + telegramId + "&select=id,anonymous_id,status";
  supabaseRequest("GET", searchPath, null, function(err, result) {
    if (err || !result || result.length === 0) {
      var newUser = {
        telegram_id: telegramId,
        telegram_username: username,
        whatsapp_phone: "tg_" + telegramId, // placeholder hasta onboarding real via Tally
        status: "active"
      };
      supabaseRequest("POST", "/rest/v1/users", newUser, function(err2, created) {
        if (err2 || !created || created.length === 0) {
          console.error("Error creando usuario:", err2);
          callback(null, null);
          return;
        }
        var wallet = { user_id: created[0].id };
        supabaseRequest("POST", "/rest/v1/wallets", wallet, function() {});
        callback(created[0].id, created[0].anonymous_id);
      });
    } else {
      callback(result[0].id, result[0].anonymous_id);
    }
  });
}

function getOrCreateActiveDrop(callback) {
  var searchPath = "/rest/v1/drops?status=eq.active&select=id,drop_number&limit=1";
  supabaseRequest("GET", searchPath, null, function(err, result) {
    if (err || !result || result.length === 0) {
      var newDrop = {
        name: "Drop Test #1",
        drop_number: 1,
        status: "active",
        total_interactions: 20,
        window_open: new Date().toISOString()
      };
      supabaseRequest("POST", "/rest/v1/drops", newDrop, function(err2, created) {
        if (err2 || !created || created.length === 0) {
          console.error("Error creando drop:", err2);
          callback(null);
          return;
        }
        callback(created[0].id);
      });
    } else {
      callback(result[0].id);
    }
  });
}

function saveResponse(data) {
  if (!data.anonymous_id || !data.drop_id) {
    console.log("[SKIP] Respuesta sin anonymous_id o drop_id");
    return;
  }

  var record = {
    anonymous_id: data.anonymous_id,
    drop_id: data.drop_id,
    interaction_id: null,
    response_value: String(data.response),
    response_type: data.interaction_type,
    latency_ms: data.latency_ms,
    sent_at: new Date(data.timestamp).toISOString(),
    responded_at: new Date().toISOString(),
    trap_passed: data.trap_result === "PASS" ? true : data.trap_result === "FAIL" ? false : null,
    is_valid: true,
    drop_number: data.interaction_num,
    interaction_position: data.interaction_num,
    media_file_id: data.media_file_id || null,
    media_type: data.media_type || null
  };

  supabaseRequest("POST", "/rest/v1/drop_responses", record, function(err, result) {
    if (err) {
      console.error("Error guardando respuesta:", err.message);
    } else {
      console.log("[SUPABASE] Respuesta guardada - interaccion:", data.interaction_num, data.media_type ? "| media: " + data.media_type : "");
    }
  });
}

function updateWallet(userId, points) {
  if (!userId || points <= 0) return;
  var path = "/rest/v1/wallets?user_id=eq." + userId + "&select=id,cash_balance,cash_total";
  supabaseRequest("GET", path, null, function(err, result) {
    if (err || !result || result.length === 0) return;
    var current = result[0];
    var cashToAdd = points * 0.01;
    var update = {
      cash_balance: parseFloat(current.cash_balance) + cashToAdd,
      cash_total: parseFloat(current.cash_total) + cashToAdd,
      last_earned_at: new Date().toISOString()
    };
    supabaseRequest("PATCH", "/rest/v1/wallets?user_id=eq." + userId, update, function() {});
  });
}

// ─── LOG ─────────────────────────────────────────────────────────────

function logData(data) {
  console.log("[DATA] " + JSON.stringify(data));

  if (data.anonymous_id && data.interaction_type !== "system") {
    saveResponse(data);
  }

  if (LOG_CHANNEL) {
    var msg = "#i" + data.interaction_num + " " + data.interaction_type + " | " + data.interaction_name + "\n" +
      "User: " + data.username + "\n" +
      "Response: " + data.response + "\n" +
      "Latency: " + data.latency_ms + "ms | Points: " + data.cumulative_points;
    if (data.trap_result) msg += " | Trap: " + data.trap_result;
    if (data.media_type) msg += " | Media: " + data.media_type;
    if (data.completed_drop) msg += "\n██ DROP COMPLETED ██";
    bot.telegram.sendMessage(LOG_CHANNEL, msg).catch(function(err) {
      console.error("Channel log error:", err.message);
    });
  }

  var csvLine = [
    data.timestamp, data.telegram_id, data.username, data.interaction_num,
    data.interaction_type, data.interaction_name, '"' + String(data.response).replace(/"/g, '""') + '"',
    data.latency_ms, data.cumulative_points, data.trap_result, data.completed_drop
  ].join(",") + "\n";

  fs.appendFile("/tmp/brutal_data.csv", csvLine, function(err) {
    if (err) console.error("CSV write error:", err.message);
  });
}

// ─── INTERACCIONES ────────────────────────────────────────────────────

var INTERACTIONS = [
  {
    id: 1, type: "culture", name: "opener_moda",
    text: "👀 Sin pensar.\n\n¿Quién te vende mejor una zapatilla?\n\nUn pibe de 17 filmándose en el espejo con el outfit — o una modelo profesional con el mismo outfit.",
    options: [
      { text: "📱 El pibe", data: "pibe" },
      { text: "💎 La modelo", data: "modelo" }
    ],
    points: 10,
    reaction: "⚡ +10 — Arrancamos."
  },
  {
    id: 2, type: "brand", name: "nike_estetica",
    text: "👟 Nike saca dos campañas. ¿Cuál ponés en tu story?\n\nA: Fondo negro, zapatilla flotando, tipografía mínima.\nB: Explosión de color, distorsión, ruido visual.",
    options: [
      { text: "🖤 Minimalista", data: "minimal" },
      { text: "🌈 Explosión", data: "explosion" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 3, type: "culture", name: "cultura_genero",
    text: "🤔 Pensá en los pibes de tu edad.\n\nHoy ser hombre es más fácil o más difícil que hace 10 años?",
    options: [
      { text: "👍 Más fácil", data: "facil" },
      { text: "👎 Más difícil", data: "dificil" },
      { text: "🔄 Distinto, ni más fácil ni más difícil", data: "distinto" }
    ],
    points: 10,
    reaction: "⚡ +10"
  },
  {
    id: 4, type: "brand", name: "politicoA_dolar_proyeccion",
    text: "💵 ¿La mayoría de los pibes de tu edad bancaría una dolarización total de la economía?",
    options: [
      { text: "✅ Sí, la mayoría banca", data: "si_mayoria" },
      { text: "❌ No, la mayoría no banca", data: "no_mayoria" },
      { text: "🤷 Les chupa un huevo", data: "indiferencia" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 5, type: "trap", name: "trap_boton_azul",
    text: "⚠️ TOCÁ EL BOTÓN AZUL.",
    options: [
      { text: "🔴 ROJO", data: "rojo" },
      { text: "🔵 AZUL", data: "azul" }
    ],
    correct: "azul",
    pointsWin: 10,
    pointsLose: -10,
    reactionPass: "✅ Buen ojo. +10 bonus.",
    reactionFail: "👁 Te agarramos en piloto automático. -10."
  },
  {
    id: 6, type: "brand", name: "spotify_verguenza",
    text: "🎧 Una canción que escuchás en loop pero JAMÁS pondrías en una juntada.\n\n✍️ Escribí lo que quieras.",
    options: "free_text",
    points: 15,
    reaction: "🤫 Secreto guardado. ⚡ +$0.15"
  },
  {
    id: 7, type: "culture", name: "cultura_emigrar",
    text: "💊 Elegí una. No hay tercera opción.\n\n🔵 Vivir en Argentina ganando bien en pesos.\n🔴 Vivir afuera ganando lo mismo en dólares.",
    options: [
      { text: "🔵 Argentina", data: "argentina" },
      { text: "🔴 Afuera", data: "afuera" }
    ],
    points: 10,
    reaction: "⚡ +10"
  },
  {
    id: 8, type: "brand", name: "afa_consumo_futbol",
    text: "⚽ ¿Cómo mirás fútbol? Elegí TODAS las que aplican.\n\nCuando termines tocá LISTO.",
    options: [
      { text: "📺 TV cable", data: "tv" },
      { text: "📱 Streaming pago", data: "streaming" },
      { text: "🏴‍☠️ Pirata", data: "pirata" },
      { text: "🏟️ En la cancha", data: "cancha" },
      { text: "🐦 Solo clips en redes", data: "clips" },
      { text: "❌ No miro fútbol", data: "no_miro" }
    ],
    multiSelect: true,
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 9, type: "brand", name: "politicoB_milei_escala",
    text: "🇲 Milei. Instinto puro. ¿Cómo te cae hoy?",
    options: [
      { text: "🟢🟢 Lo banco fuerte", data: "5" },
      { text: "🟢 Tibio", data: "4" },
      { text: "⚪ Meh", data: "3" },
      { text: "🔴 Cansa", data: "2" },
      { text: "🔴🔴 Harto", data: "1" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 10, type: "culture", name: "cultura_messi_maradona",
    text: "🔥 HOT TAKE. Sin pensar.\n\nMessi es más grande que Maradona.",
    options: [
      { text: "✅ De acuerdo", data: "acuerdo" },
      { text: "❌ Ni en pedo", data: "desacuerdo" }
    ],
    points: 10,
    reaction: "⚡ +10 💯"
  },
  {
    id: 11, type: "brand", name: "meli_precio_inmediatez",
    text: "📦 Pedís algo en MeLi. Llega en 3 días.\n\n¿Cuánto más pagarías para que llegue HOY?",
    options: [
      { text: "😴 $0, me espero", data: "0" },
      { text: "💸 Hasta $500", data: "500" },
      { text: "💰 $500-$2000", data: "2000" },
      { text: "🤑 Más de $2000", data: "2000+" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 12, type: "trap", name: "trap_agua_moja",
    text: "🧐 Pregunta seria.\n\n¿El agua moja?",
    options: [
      { text: "💧 Sí", data: "si" },
      { text: "🏜️ No", data: "no" },
      { text: "🤔 Depende el agua", data: "depende" }
    ],
    correct: "si",
    pointsWin: 10,
    pointsLose: -5,
    reactionPass: "✅ Seguís ahí. +10.",
    reactionFail: "👁 Hmm. -5."
  },
  {
    id: 13, type: "brand", name: "spotify_crush",
    text: "💘 Situación: tu crush mira tu Spotify.\n\n¿Qué playlist preferís que vea?",
    options: [
      { text: "🎵 Mi playlist real", data: "real" },
      { text: "✨ Una armada para impresionar", data: "armada" }
    ],
    points: 10,
    reactionFn: true
  },
  {
    id: 14, type: "brand", name: "politicoA_dolar_costo",
    text: "💵 Vuelve el tema.\n\nArgentina dolariza. Tu familia gana lo mismo pero tu celu nuevo sale el doble.\n\n¿Seguís bancando?",
    options: [
      { text: "✅ SÍ, banco", data: "si" },
      { text: "❌ No, así no", data: "no" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 15, type: "culture", name: "cultura_miedo",
    text: "🖤 Última de este tipo. Sin filtro.\n\n¿De qué tenés miedo de verdad?\n\n✍️ Escribí lo que quieras.",
    options: "free_text",
    points: 20,
    reaction: "⚡ +20 — Gracias por la honestidad."
  },
  {
    id: 16, type: "brand", name: "nike_sin_logo",
    text: "👟 Ves a un pibe en la calle con unas zapatillas que te encantan. No tienen logo visible. Ninguna marca.\n\n¿Las usarías igual?",
    options: [
      { text: "🔥 Sí, si me gustan no necesito logo", data: "sin_logo_si" },
      { text: "🌟 Depende, quiero saber la marca", data: "sin_logo_depende" },
      { text: "❌ Sin marca no las uso", data: "sin_logo_no" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 17, type: "brand", name: "afa_futuro_futbol",
    text: "🔮 Modo futurólogo.\n\nEn 5 años, el fútbol argentino se va a ver...",
    options: [
      { text: "📱 Todo streaming", data: "streaming" },
      { text: "🏟️ Vuelve la cancha", data: "cancha" },
      { text: "🎮 Muere, gana el gaming", data: "gaming" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 18, type: "brand", name: "politicoB_2027",
    text: "🗳️ Elecciones 2027. Dos opciones.\n\nNo hay tercera. No hay blanco. No hay nulo.\n\nContinuidad del modelo Milei — o vuelta al kirchnerismo.",
    options: [
      { text: "🟡 Continuidad Milei", data: "milei" },
      { text: "🟢 Vuelta K", data: "kirchnerismo" }
    ],
    points: 10,
    reaction: "⚡ +$0.10"
  },
  {
    id: 19, type: "trap", name: "trap_leer_bien",
    text: "💡 Leé bien antes de tocar.\n\n¿Cuántos meses tiene un año que tienen 28 días?",
    options: [
      { text: "1️⃣ Solo febrero", data: "1" },
      { text: "💯 Todos", data: "todos" }
    ],
    correct: "todos",
    pointsWin: 10,
    pointsLose: -5,
    reactionPass: "✅ Bien. Todos los meses tienen al menos 28. +10.",
    reactionFail: "👁 Leé de nuevo. Todos tienen al menos 28 días. -5."
  },
  {
    id: 20, type: "culture", name: "cultura_cierre_deseo",
    text: "🎭 Última. Completá la frase.\n\nSi mañana desapareciera de Argentina, nadie extrañaría ___\n\n✍️ Escribí lo primero que se te viene.",
    options: "free_text",
    points: 20,
    reaction: "⚡ +20 — Drop completo."
  }
];

// ─── FLUJO DEL DROP ───────────────────────────────────────────────────

function sendInteraction(ctx, session) {
  var idx = session.current;
  if (idx >= INTERACTIONS.length) {
    return finishDrop(ctx, session);
  }

  var inter = INTERACTIONS[idx];
  var progress = "📊 " + (idx + 1) + "/" + INTERACTIONS.length + "\n\n";

  if (inter.multiSelect) {
    session.multiSelectState = { selected: {}, messageId: null };
    var keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
    session.lastSentAt = Date.now();
    return ctx.reply(progress + inter.text, keyboard).then(function(msg) {
      session.multiSelectState.messageId = msg.message_id;
    });
  }

  if (inter.options === "free_text") {
    session.awaitingText = true;
    session.lastSentAt = Date.now();
    return ctx.reply(progress + inter.text);
  }

  if (inter.options === "media") {
    session.awaitingMedia = true;
    session.lastSentAt = Date.now();
    return ctx.reply(progress + inter.text);
  }

  var buttons = [];
  for (var i = 0; i < inter.options.length; i++) {
    var opt = inter.options[i];
    buttons.push(Markup.button.callback(opt.text, "resp_" + idx + "_" + opt.data));
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

  session.lastSentAt = Date.now();
  return ctx.reply(progress + inter.text, Markup.inlineKeyboard(rows));
}

function buildMultiSelectKeyboard(inter, selected) {
  var buttons = [];
  for (var i = 0; i < inter.options.length; i++) {
    var opt = inter.options[i];
    var check = selected[opt.data] ? "✅ " : "";
    buttons.push([Markup.button.callback(check + opt.text, "multi_" + opt.data)]);
  }
  buttons.push([Markup.button.callback("✔️ LISTO", "multi_done")]);
  return Markup.inlineKeyboard(buttons);
}

function processResponse(ctx, session, responseData, mediaData) {
  var idx = session.current;
  var inter = INTERACTIONS[idx];
  var latency = session.lastSentAt ? Date.now() - session.lastSentAt : 0;

  var points = inter.points || 0;
  var trapResult = "";

  if (inter.type === "trap") {
    if (responseData === inter.correct) {
      points = inter.pointsWin;
      trapResult = "PASS";
      session.trapsPassed++;
    } else {
      points = inter.pointsLose;
      trapResult = "FAIL";
      session.trapsFailed++;
    }
  }

  session.points += points;
  if (session.points < 0) session.points = 0;

  if (session.user_id && points > 0) {
    updateWallet(session.user_id, points);
  }

  var logEntry = {
    timestamp: new Date().toISOString(),
    telegram_id: session.telegram_id,
    username: session.username,
    anonymous_id: session.anonymous_id,
    drop_id: session.drop_id,
    interaction_num: inter.id,
    interaction_type: inter.type,
    interaction_name: inter.name,
    response: responseData,
    latency_ms: latency,
    cumulative_points: session.points,
    trap_result: trapResult,
    completed_drop: ""
  };

  // Agregar datos de media si existen
  if (mediaData) {
    logEntry.media_file_id = mediaData.file_id;
    logEntry.media_type = mediaData.type;
  }

  logData(logEntry);

  var reaction;
  if (inter.type === "trap") {
    reaction = trapResult === "PASS" ? inter.reactionPass : inter.reactionFail;
  } else if (inter.reactionFn) {
    reaction = responseData === "real" ? "⚡ +$0.10 — Seguro que sí." : "⚡ +$0.10 — Honestidad brutal.";
  } else {
    reaction = inter.reaction;
  }

  var pointsDisplay = "\n\n💰 " + session.points + " puntos";

  return ctx.reply(reaction + pointsDisplay).then(function() {
    return new Promise(function(resolve) { setTimeout(resolve, 600); });
  }).then(function() {
    session.current++;
    return sendInteraction(ctx, session);
  });
}

function finishDrop(ctx, session) {
  session.finished = true;

  var total = session.trapsPassed + session.trapsFailed;
  var trapScore = total > 0 ? Math.round((session.trapsPassed / total) * 100) : 100;

  var summary = "🏁 DROP COMPLETO\n\n" +
    "💰 Puntos finales: " + session.points + "\n" +
    "✅ Traps: " + session.trapsPassed + "/" + total + " correctas (" + trapScore + "%)\n" +
    "📊 " + INTERACTIONS.length + " interacciones completadas\n\n" +
    "Tu señal fue registrada.\nNadie sabe qué respondiste. 🤫\n\n" +
    "📱 Próximamente: tu perfil, wallet y ranking en The Insight Club.";

  logData({
    timestamp: new Date().toISOString(),
    telegram_id: session.telegram_id,
    username: session.username,
    anonymous_id: session.anonymous_id,
    drop_id: session.drop_id,
    interaction_num: 0,
    interaction_type: "system",
    interaction_name: "drop_completed",
    response: "points:" + session.points + "_traps:" + trapScore + "%",
    latency_ms: 0,
    cumulative_points: session.points,
    trap_result: session.trapsPassed + "/" + total,
    completed_drop: "YES"
  });

  return ctx.reply(summary);
}

// ─── HANDLERS ────────────────────────────────────────────────────────

bot.start(function(ctx) {
  var session = getSession(ctx);

  // Si viene con invite_code via deep link (?start=CODIGO), linkear al usuario
  var startPayload = ctx.startPayload;
  if (startPayload && startPayload.length > 0) {
    console.log("[INVITE] Deep link recibido:", startPayload);
    // Buscar usuario por invite_code y linkearlo con este telegram_id
    var linkPath = "/rest/v1/users?invite_code=eq." + startPayload + "&select=id,anonymous_id,status";
    supabaseRequest("GET", linkPath, null, function(err, result) {
      if (!err && result && result.length > 0) {
        var update = {
          telegram_id: ctx.from.id,
          telegram_username: ctx.from.username || ctx.from.first_name || "anon",
          telegram_linked_at: new Date().toISOString(),
          status: "active"
        };
        supabaseRequest("PATCH", "/rest/v1/users?invite_code=eq." + startPayload, update, function() {
          console.log("[INVITE] Usuario linkeado con telegram_id:", ctx.from.id);
        });
      }
    });
  }

  if (session.finished) {
    return ctx.reply("Ya completaste el Drop. Gracias por participar. 🤝");
  }
  if (session.started) {
    return ctx.reply("Ya arrancaste. Seguí respondiendo. 👇");
  }

  var welcome = "💣 *BRUTAL*\n\n" +
    "──────────────────\n\n" +
    "🎯 *20 interacciones*\n" +
    "⏱ *3 minutos*\n" +
    "💵 *Sumá cash + golden tickets*\n\n" +
    "──────────────────\n\n" +
    "Respondé rápido. Nadie ve tus respuestas.\n" +
    "Sin filtro. Sin consecuencias.\n" +
    "Si te agarramos en piloto automático, restás.\n\n" +
    "¿Arrancamos?";

  return ctx.reply(welcome, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🚀 ARRANCAR", "start_drop")],
      [Markup.button.callback("⏰ Después", "later")]
    ])
  });
});

bot.action("start_drop", function(ctx) {
  return ctx.answerCbQuery().then(function() {
    var session = getSession(ctx);
    if (session.started) return;

    session.started = true;
    session.current = 0;

    return ctx.reply("🔥 Vamos.").then(function() {
      return new Promise(function(resolve) {
        getOrCreateUser(session.telegram_id, session.username, function(userId, anonymousId) {
          session.user_id = userId;
          session.anonymous_id = anonymousId;
          console.log("[SUPABASE] Usuario listo - anonymous_id:", anonymousId);

          getOrCreateActiveDrop(function(dropId) {
            session.drop_id = dropId;
            console.log("[SUPABASE] Drop activo:", dropId);

            logData({
              timestamp: new Date().toISOString(),
              telegram_id: session.telegram_id,
              username: session.username,
              anonymous_id: anonymousId,
              drop_id: dropId,
              interaction_num: 0,
              interaction_type: "system",
              interaction_name: "drop_started",
              response: "START",
              latency_ms: 0,
              cumulative_points: 0,
              trap_result: "",
              completed_drop: ""
            });

            setTimeout(resolve, 300);
          });
        });
      });
    }).then(function() {
      return sendInteraction(ctx, session);
    });
  });
});

bot.action("later", function(ctx) {
  return ctx.answerCbQuery().then(function() {
    return ctx.reply("👌 Cuando quieras, mandá /start.");
  });
});

bot.action(/^resp_(\d+)_(.+)$/, function(ctx) {
  return ctx.answerCbQuery().then(function() {
    var session = getSession(ctx);
    if (session.finished) return;
    var actionIdx = parseInt(ctx.match[1]);
    var responseData = ctx.match[2];
    if (actionIdx !== session.current) return;
    return processResponse(ctx, session, responseData);
  });
});

bot.action(/^multi_(.+)$/, function(ctx) {
  return ctx.answerCbQuery().then(function() {
    var session = getSession(ctx);
    if (session.finished) return;
    if (!session.multiSelectState) return;
    var value = ctx.match[1];
    var inter = INTERACTIONS[session.current];

    if (value === "done") {
      var selected = Object.keys(session.multiSelectState.selected);
      if (selected.length === 0) {
        return ctx.reply("☝️ Tocá al menos una opción antes de LISTO.");
      }
      var responseData = selected.join(",");
      session.multiSelectState = null;
      return processResponse(ctx, session, responseData);
    }

    if (session.multiSelectState.selected[value]) {
      delete session.multiSelectState.selected[value];
    } else {
      session.multiSelectState.selected[value] = true;
    }

    try {
      var keyboard = buildMultiSelectKeyboard(inter, session.multiSelectState.selected);
      return ctx.editMessageReplyMarkup(keyboard.reply_markup);
    } catch (e) {}
  });
});

// Texto libre
bot.on("text", function(ctx) {
  var session = getSession(ctx);
  if (!session.started || session.finished) return;
  if (!session.awaitingText) return;
  session.awaitingText = false;
  var text = ctx.message.text.substring(0, 500);
  return processResponse(ctx, session, text);
});

// Audio — se graba file_id y se marca como audio
bot.on("voice", function(ctx) {
  var session = getSession(ctx);
  if (!session.started || session.finished) return;
  if (!session.awaitingText && !session.awaitingMedia) return;
  session.awaitingText = false;
  session.awaitingMedia = false;
  var fileId = ctx.message.voice.file_id;
  var duration = ctx.message.voice.duration;
  return processResponse(ctx, session, "[audio:" + duration + "s]", { file_id: fileId, type: "audio" });
});

// Sticker — se graba emoji y file_id
bot.on("sticker", function(ctx) {
  var session = getSession(ctx);
  if (!session.started || session.finished) return;
  if (!session.awaitingText && !session.awaitingMedia) return;
  session.awaitingText = false;
  session.awaitingMedia = false;
  var sticker = ctx.message.sticker;
  var emoji = sticker.emoji || "🎭";
  var fileId = sticker.file_id;
  return processResponse(ctx, session, "[sticker:" + emoji + "]", { file_id: fileId, type: "sticker" });
});

// Imagen
bot.on("photo", function(ctx) {
  var session = getSession(ctx);
  if (!session.started || session.finished) return;
  if (!session.awaitingText && !session.awaitingMedia) return;
  session.awaitingText = false;
  session.awaitingMedia = false;
  var photos = ctx.message.photo;
  var fileId = photos[photos.length - 1].file_id; // mayor resolución
  return processResponse(ctx, session, "[imagen]", { file_id: fileId, type: "image" });
});

bot.command("reset", function(ctx) {
  delete sessions[ctx.from.id];
  return ctx.reply("🔄 Reseteado. Mandá /start para arrancar de nuevo.");
});

bot.command("forcestart", function(ctx) {
  delete sessions[ctx.from.id];
  var session = getSession(ctx);
  session.started = true;
  session.current = 0;

  return ctx.reply("🔥 Force start. Vamos.").then(function() {
    return new Promise(function(resolve) {
      getOrCreateUser(session.telegram_id, session.username, function(userId, anonymousId) {
        session.user_id = userId;
        session.anonymous_id = anonymousId;
        getOrCreateActiveDrop(function(dropId) {
          session.drop_id = dropId;
          setTimeout(resolve, 300);
        });
      });
    });
  }).then(function() {
    return sendInteraction(ctx, session);
  });
});

bot.command("status", function(ctx) {
  var session = getSession(ctx);
  if (!session.started) return ctx.reply("No arrancaste todavía. Mandá /start.");
  if (session.finished) return ctx.reply("✅ Drop completado. " + session.points + " puntos.");
  return ctx.reply("📊 Interacción " + (session.current + 1) + "/" + INTERACTIONS.length + ". " + session.points + " puntos.");
});

// ─── INICIO ──────────────────────────────────────────────────────────

var csvHeaders = "timestamp,telegram_id,username,interaction_num,interaction_type,interaction_name,response,latency_ms,cumulative_points,trap_result,completed_drop\n";
fs.writeFileSync("/tmp/brutal_data.csv", csvHeaders);

bot.launch().then(function() {
  console.log("BRUTAL Bot arranco. Esperando nodos...");
  console.log("Supabase URL:", SUPABASE_URL ? "OK" : "FALTA");
  console.log("Supabase Key:", SUPABASE_KEY ? "OK" : "FALTA");
  if (LOG_CHANNEL) console.log("Logging to Telegram channel: " + LOG_CHANNEL);
});

process.once("SIGINT", function() { bot.stop("SIGINT"); });
process.once("SIGTERM", function() { bot.stop("SIGTERM"); });
