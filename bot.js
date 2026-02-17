var Telegraf = require("telegraf").Telegraf;
var Markup = require("telegraf").Markup;
var https = require("https");
var fs = require("fs");

var BOT_TOKEN = process.env.BOT_TOKEN;
var SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK || "";
var LOG_CHANNEL = process.env.LOG_CHANNEL || "";

if (!BOT_TOKEN) { console.error("ERROR: BOT_TOKEN no definido"); process.exit(1); }

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
      multiSelectState: null
    };
  }
  return sessions[id];
}

function logData(data) {
  console.log("[DATA] " + JSON.stringify(data));

  if (LOG_CHANNEL) {
    var msg = "#i" + data.interaction_num + " " + data.interaction_type + " | " + data.interaction_name + "\n" +
      "User: " + data.username + " (" + data.telegram_id + ")\n" +
      "Response: " + data.response + "\n" +
      "Latency: " + data.latency_ms + "ms | Points: " + data.cumulative_points;
    if (data.trap_result) msg += " | Trap: " + data.trap_result;
    if (data.completed_drop) msg += "\n\u2588\u2588 DROP COMPLETED \u2588\u2588";
    
    bot.telegram.sendMessage(LOG_CHANNEL, msg).catch(function(err) {
      console.error("Channel log error:", err.message);
    });
  }

  if (SHEET_WEBHOOK && SHEET_WEBHOOK.indexOf("script.google.com") !== -1) {
    try {
      var postData = JSON.stringify(data);
      var urlParts = new URL(SHEET_WEBHOOK);
      var options = {
        hostname: urlParts.hostname,
        path: urlParts.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      };
      var req = https.request(options, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, function(r) { r.resume(); });
        }
        res.resume();
      });
      req.on("error", function() {});
      req.write(postData);
      req.end();
    } catch(e) {}
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

var INTERACTIONS = [
  // 1. CULTURE - OPENER
  {
    id: 1, type: "culture", name: "opener_moda",
    text: "\ud83d\udc40 Sin pensar.\n\n\u00bfQui\u00e9n te vende mejor una zapatilla?\n\nUn pibe de 17 film\u00e1ndose en el espejo con el outfit \u2014 o una modelo profesional con el mismo outfit.",
    options: [
      { text: "\ud83d\udcf1 El pibe", data: "pibe" },
      { text: "\ud83d\udc8e La modelo", data: "modelo" }
    ],
    points: 10,
    reaction: "\u26a1 +10 \u2014 Arrancamos."
  },
  // 2. NIKE - BRAND 1/2
  {
    id: 2, type: "brand", name: "nike_estetica",
    text: "\ud83d\udc5f Nike saca dos campa\u00f1as. \u00bfCu\u00e1l pon\u00e9s en tu story?\n\nA: Fondo negro, zapatilla flotando, tipograf\u00eda m\u00ednima.\nB: Explosi\u00f3n de color, distorsi\u00f3n, ruido visual.",
    options: [
      { text: "\ud83d\udda4 Minimalista", data: "minimal" },
      { text: "\ud83c\udf08 Explosi\u00f3n", data: "explosion" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 3. CULTURE - IDENTIDAD
  {
    id: 3, type: "culture", name: "cultura_genero",
    text: "\ud83e\udd14 Pens\u00e1 en los pibes de tu edad.\n\nHoy ser hombre es m\u00e1s f\u00e1cil o m\u00e1s dif\u00edcil que hace 10 a\u00f1os?",
    options: [
      { text: "\ud83d\udc4d M\u00e1s f\u00e1cil", data: "facil" },
      { text: "\ud83d\udc4e M\u00e1s dif\u00edcil", data: "dificil" },
      { text: "\ud83d\udd04 Distinto, ni m\u00e1s f\u00e1cil ni m\u00e1s dif\u00edcil", data: "distinto" }
    ],
    points: 10,
    reaction: "\u26a1 +10"
  },
  // 4. POLÍTICO A - BRAND 1/2
  {
    id: 4, type: "brand", name: "politicoA_dolar_proyeccion",
    text: "\ud83d\udcb5 \u00bfLa mayor\u00eda de los pibes de tu edad bancar\u00eda una dolarizaci\u00f3n total de la econom\u00eda?",
    options: [
      { text: "\u2705 S\u00ed, la mayor\u00eda banca", data: "si_mayoria" },
      { text: "\u274c No, la mayor\u00eda no banca", data: "no_mayoria" },
      { text: "\ud83e\udd37 Les chupa un huevo", data: "indiferencia" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 5. TRAP 1
  {
    id: 5, type: "trap", name: "trap_boton_azul",
    text: "\u26a0\ufe0f TOC\u00c1 EL BOT\u00d3N AZUL.",
    options: [
      { text: "\ud83d\udd34 ROJO", data: "rojo" },
      { text: "\ud83d\udd35 AZUL", data: "azul" }
    ],
    correct: "azul",
    pointsWin: 10,
    pointsLose: -10,
    reactionPass: "\u2705 Buen ojo. +10 bonus.",
    reactionFail: "\ud83d\udc41 Te agarramos en piloto autom\u00e1tico. -10."
  },
  // 6. SPOTIFY - BRAND 1/2 (confesionario)
  {
    id: 6, type: "brand", name: "spotify_verguenza",
    text: "\ud83c\udfa7 Una canci\u00f3n que escuch\u00e1s en loop pero JAM\u00c1S pondr\u00edas en una juntada.\n\n\u270d\ufe0f Escrib\u00ed lo que quieras.",
    options: "free_text",
    points: 15,
    reaction: "\ud83e\udd2b Secreto guardado. \u26a1 +$0.15"
  },
  // 7. CULTURE - RED PILL / BLUE PILL
  {
    id: 7, type: "culture", name: "cultura_emigrar",
    text: "\ud83d\udc8a Eleg\u00ed una. No hay tercera opci\u00f3n.\n\n\ud83d\udd35 Vivir en Argentina ganando bien en pesos.\n\ud83d\udd34 Vivir afuera ganando lo mismo en d\u00f3lares.",
    options: [
      { text: "\ud83d\udd35 Argentina", data: "argentina" },
      { text: "\ud83d\udd34 Afuera", data: "afuera" }
    ],
    points: 10,
    reaction: "\u26a1 +10"
  },
  // 8. AFA - BRAND 1/2 (multi-select)
  {
    id: 8, type: "brand", name: "afa_consumo_futbol",
    text: "\u26bd \u00bfC\u00f3mo mir\u00e1s f\u00fatbol? Eleg\u00ed TODAS las que aplican.\n\nCuando termines toc\u00e1 LISTO.",
    options: [
      { text: "\ud83d\udcfa TV cable", data: "tv" },
      { text: "\ud83d\udcf1 Streaming pago", data: "streaming" },
      { text: "\ud83c\udff4\u200d\u2620\ufe0f Pirata", data: "pirata" },
      { text: "\ud83c\udfdf\ufe0f En la cancha", data: "cancha" },
      { text: "\ud83d\udc26 Solo clips en redes", data: "clips" },
      { text: "\u274c No miro f\u00fatbol", data: "no_miro" }
    ],
    multiSelect: true,
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 9. POLÍTICO B - BRAND 1/2 (escala Milei)
  {
    id: 9, type: "brand", name: "politicoB_milei_escala",
    text: "\ud83c\uddf2 Milei. Instinto puro. \u00bfC\u00f3mo te cae hoy?",
    options: [
      { text: "\ud83d\udfe2\ud83d\udfe2 Lo banco fuerte", data: "5" },
      { text: "\ud83d\udfe2 Tibio", data: "4" },
      { text: "\u26aa Meh", data: "3" },
      { text: "\ud83d\udd34 Cansa", data: "2" },
      { text: "\ud83d\udd34\ud83d\udd34 Harto", data: "1" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 10. CULTURE - HOT TAKE
  {
    id: 10, type: "culture", name: "cultura_messi_maradona",
    text: "\ud83d\udd25 HOT TAKE. Sin pensar.\n\nMessi es m\u00e1s grande que Maradona.",
    options: [
      { text: "\u2705 De acuerdo", data: "acuerdo" },
      { text: "\u274c Ni en pedo", data: "desacuerdo" }
    ],
    points: 10,
    reaction: "\u26a1 +10 \ud83d\udcaf"
  },
  // 11. MELI - BRAND 1/1
  {
    id: 11, type: "brand", name: "meli_precio_inmediatez",
    text: "\ud83d\udce6 Ped\u00eds algo en MeLi. Llega en 3 d\u00edas.\n\n\u00bfCu\u00e1nto m\u00e1s pagar\u00edas para que llegue HOY?",
    options: [
      { text: "\ud83d\ude34 $0, me espero", data: "0" },
      { text: "\ud83d\udcb8 Hasta $500", data: "500" },
      { text: "\ud83d\udcb0 $500-$2000", data: "2000" },
      { text: "\ud83e\udd11 M\u00e1s de $2000", data: "2000+" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 12. TRAP 2
  {
    id: 12, type: "trap", name: "trap_agua_moja",
    text: "\ud83e\uddd0 Pregunta seria.\n\n\u00bfEl agua moja?",
    options: [
      { text: "\ud83d\udca7 S\u00ed", data: "si" },
      { text: "\ud83c\udfdc\ufe0f No", data: "no" },
      { text: "\ud83e\udd14 Depende el agua", data: "depende" }
    ],
    correct: "si",
    pointsWin: 10,
    pointsLose: -5,
    reactionPass: "\u2705 Segu\u00eds ah\u00ed. +10.",
    reactionFail: "\ud83d\udc41 Hmm. -5."
  },
  // 13. SPOTIFY - BRAND 2/2
  {
    id: 13, type: "brand", name: "spotify_crush",
    text: "\ud83d\udc98 Situaci\u00f3n: tu crush mira tu Spotify.\n\n\u00bfQu\u00e9 playlist prefer\u00eds que vea?",
    options: [
      { text: "\ud83c\udfb5 Mi playlist real", data: "real" },
      { text: "\u2728 Una armada para impresionar", data: "armada" }
    ],
    points: 10,
    reactionFn: true
  },
  // 14. POLÍTICO A - BRAND 2/2
  {
    id: 14, type: "brand", name: "politicoA_dolar_costo",
    text: "\ud83d\udcb5 Vuelve el tema.\n\nArgentina dolariza. Tu familia gana lo mismo pero tu celu nuevo sale el doble.\n\n\u00bfSegu\u00eds bancando?",
    options: [
      { text: "\u2705 S\u00cd, banco", data: "si" },
      { text: "\u274c No, as\u00ed no", data: "no" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 15. CULTURE - CONFESIONARIO PROFUNDO
  {
    id: 15, type: "culture", name: "cultura_miedo",
    text: "\ud83d\udda4 \u00daltima de este tipo. Sin filtro.\n\n\u00bfDe qu\u00e9 ten\u00e9s miedo de verdad?\n\n\u270d\ufe0f Escrib\u00ed lo que quieras.",
    options: "free_text",
    points: 20,
    reaction: "\u26a1 +20 \u2014 Gracias por la honestidad."
  },
  // 16. NIKE - BRAND 2/2 (reemplazada: sin imagen, situacional)
  {
    id: 16, type: "brand", name: "nike_sin_logo",
    text: "\ud83d\udc5f Ves a un pibe en la calle con unas zapatillas que te encantan. No tienen logo visible. Ninguna marca.\n\n\u00bfLas usar\u00edas igual?",
    options: [
      { text: "\ud83d\udd25 S\u00ed, si me gustan no necesito logo", data: "sin_logo_si" },
      { text: "\ud83c\udf1f Depende, quiero saber la marca", data: "sin_logo_depende" },
      { text: "\u274c Sin marca no las uso", data: "sin_logo_no" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 17. AFA - BRAND 2/2
  {
    id: 17, type: "brand", name: "afa_futuro_futbol",
    text: "\ud83d\udd2e Modo futur\u00f3logo.\n\nEn 5 a\u00f1os, el f\u00fatbol argentino se va a ver...",
    options: [
      { text: "\ud83d\udcf1 Todo streaming", data: "streaming" },
      { text: "\ud83c\udfdf\ufe0f Vuelve la cancha", data: "cancha" },
      { text: "\ud83c\udfae Muere, gana el gaming", data: "gaming" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 18. POLÍTICO B - BRAND 2/2
  {
    id: 18, type: "brand", name: "politicoB_2027",
    text: "\ud83d\uddf3\ufe0f Elecciones 2027. Dos opciones.\n\nNo hay tercera. No hay blanco. No hay nulo.\n\nContinuidad del modelo Milei \u2014 o vuelta al kirchnerismo.",
    options: [
      { text: "\ud83d\udfe1 Continuidad Milei", data: "milei" },
      { text: "\ud83d\udfe2 Vuelta K", data: "kirchnerismo" }
    ],
    points: 10,
    reaction: "\u26a1 +$0.10"
  },
  // 19. TRAP 3
  {
    id: 19, type: "trap", name: "trap_leer_bien",
    text: "\ud83d\udca1 Le\u00e9 bien antes de tocar.\n\n\u00bfCu\u00e1ntos meses tiene un a\u00f1o que tienen 28 d\u00edas?",
    options: [
      { text: "1\ufe0f\u20e3 Solo febrero", data: "1" },
      { text: "\ud83d\udcaf Todos", data: "todos" }
    ],
    correct: "todos",
    pointsWin: 10,
    pointsLose: -5,
    reactionPass: "\u2705 Bien. Todos los meses tienen al menos 28. +10.",
    reactionFail: "\ud83d\udc41 Le\u00e9 de nuevo. Todos tienen al menos 28 d\u00edas. -5."
  },
  // 20. CULTURE - CIERRE
  {
    id: 20, type: "culture", name: "cultura_cierre_deseo",
    text: "\ud83c\udfad \u00daltima. Complet\u00e1 la frase.\n\nSi ma\u00f1ana desapareciera de Argentina, nadie extra\u00f1ar\u00eda ___\n\n\u270d\ufe0f Escrib\u00ed lo primero que se te viene.",
    options: "free_text",
    points: 20,
    reaction: "\u26a1 +20 \u2014 Drop completo."
  }
];

function sendInteraction(ctx, session) {
  var idx = session.current;
  if (idx >= INTERACTIONS.length) {
    return finishDrop(ctx, session);
  }

  var inter = INTERACTIONS[idx];
  var progress = "\ud83d\udcca " + (idx + 1) + "/20\n\n";

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

  var keyboard = Markup.inlineKeyboard(rows);
  session.lastSentAt = Date.now();
  return ctx.reply(progress + inter.text, keyboard);
}

function buildMultiSelectKeyboard(inter, selected) {
  var buttons = [];
  for (var i = 0; i < inter.options.length; i++) {
    var opt = inter.options[i];
    var check = selected[opt.data] ? "\u2705 " : "";
    buttons.push([Markup.button.callback(check + opt.text, "multi_" + opt.data)]);
  }
  buttons.push([Markup.button.callback("\u2714\ufe0f LISTO", "multi_done")]);
  return Markup.inlineKeyboard(buttons);
}

function processResponse(ctx, session, responseData) {
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

  logData({
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
    completed_drop: ""
  });

  var reaction;
  if (inter.type === "trap") {
    reaction = trapResult === "PASS" ? inter.reactionPass : inter.reactionFail;
  } else if (inter.reactionFn) {
    reaction = responseData === "real" ? "\u26a1 +$0.10 \u2014 Seguro que s\u00ed." : "\u26a1 +$0.10 \u2014 Honestidad brutal.";
  } else {
    reaction = inter.reaction;
  }

  var pointsDisplay = "\n\n\ud83d\udcb0 " + session.points + " puntos";

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

  var summary = "\ud83c\udfc1 DROP COMPLETO\n\n" +
    "\ud83d\udcb0 Puntos finales: " + session.points + "\n" +
    "\u2705 Traps: " + session.trapsPassed + "/" + total + " correctas (" + trapScore + "%)\n" +
    "\ud83d\udcca " + INTERACTIONS.length + " interacciones completadas\n\n" +
    "Gracias. Tu se\u00f1al fue registrada.\nNadie sabe qu\u00e9 respondiste. \ud83e\udd2b";

  logData({
    timestamp: new Date().toISOString(),
    telegram_id: session.telegram_id,
    username: session.username,
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

// --- HANDLERS ---

bot.start(function(ctx) {
  var session = getSession(ctx);

  if (session.finished) {
    return ctx.reply("Ya completaste el Drop. Gracias por participar. \ud83e\udd1d");
  }
  if (session.started) {
    return ctx.reply("Ya arrancaste. Segu\u00ed respondiendo. \ud83d\udc47");
  }

  var welcome = "\ud83d\udca3 *BRUTAL*\n\n" +
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n" +
    "\ud83c\udfaf *20 interacciones*\n" +
    "\u23f1 *3 minutos*\n" +
    "\ud83d\udcb5 *Sum\u00e1 cash + golden tickets*\n\n" +
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n" +
    "Respond\u00e9 r\u00e1pido. Nadie ve tus respuestas.\n" +
    "Sin filtro. Sin consecuencias.\n" +
    "Si te agarramos en piloto autom\u00e1tico, rest\u00e1s.\n\n" +
    "\u00bfArrancamos?";

  return ctx.reply(welcome, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("\ud83d\ude80 ARRANCAR", "start_drop")],
      [Markup.button.callback("\u23f0 Despu\u00e9s", "later")]
    ])
  });
});

bot.action("start_drop", function(ctx) {
  return ctx.answerCbQuery().then(function() {
    var session = getSession(ctx);
    if (session.started) return;

    session.started = true;
    session.current = 0;

    logData({
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

    return ctx.reply("\ud83d\udd25 Vamos.").then(function() {
      return new Promise(function(resolve) { setTimeout(resolve, 500); });
    }).then(function() {
      return sendInteraction(ctx, session);
    });
  });
});

bot.action("later", function(ctx) {
  return ctx.answerCbQuery().then(function() {
    return ctx.reply("\ud83d\udc4c Cuando quieras, mand\u00e1 /start.");
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
        return ctx.reply("\u261d\ufe0f Toc\u00e1 al menos una opci\u00f3n antes de LISTO.");
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

bot.on("text", function(ctx) {
  var session = getSession(ctx);
  if (!session.started || session.finished) return;
  if (!session.awaitingText) return;
  session.awaitingText = false;
  var text = ctx.message.text.substring(0, 500);
  return processResponse(ctx, session, text);
});

bot.command("reset", function(ctx) {
  delete sessions[ctx.from.id];
  return ctx.reply("\ud83d\udd04 Reseteado. Mand\u00e1 /start para arrancar de nuevo.");
});

bot.command("status", function(ctx) {
  var session = getSession(ctx);
  if (!session.started) return ctx.reply("No arrancaste todav\u00eda. Mand\u00e1 /start.");
  if (session.finished) return ctx.reply("\u2705 Drop completado. " + session.points + " puntos.");
  return ctx.reply("\ud83d\udcca Interacci\u00f3n " + (session.current + 1) + "/" + INTERACTIONS.length + ". " + session.points + " puntos.");
});

var csvHeaders = "timestamp,telegram_id,username,interaction_num,interaction_type,interaction_name,response,latency_ms,cumulative_points,trap_result,completed_drop\n";
fs.writeFileSync("/tmp/brutal_data.csv", csvHeaders);

bot.launch().then(function() {
  console.log("BRUTAL Bot arranco. Esperando nodos...");
  if (LOG_CHANNEL) console.log("Logging to Telegram channel: " + LOG_CHANNEL);
  if (SHEET_WEBHOOK) console.log("Logging to Google Sheet webhook");
  console.log("Logging to /tmp/brutal_data.csv");
  console.log("Logging to console (Railway logs)");
});

process.once("SIGINT", function() { bot.stop("SIGINT"); });
process.once("SIGTERM", function() { bot.stop("SIGTERM"); });
