require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');

// ================================================================
// CONFIG
// ================================================================
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const ADMIN_IDS = [6949935917];

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: Faltan SUPABASE_URL o SUPABASE_KEY');
    process.exit(1);
}
if (!BOT_TOKEN) {
    console.error('ERROR: Falta BOT_TOKEN');
    process.exit(1);
}

// ================================================================
// INIT
// ================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Servir la Mini App desde /public
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('BRUTAL API starting...');

// ================================================================
// HEALTH CHECK
// ================================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ================================================================
// API: Get active drop
// La Mini App llama a esto al arrancar para saber qué Drop mostrar
// ================================================================
app.get('/api/drop/active', async (req, res) => {
    try {
        const { data: drop, error } = await supabase
            .from('drops')
            .select('slug, title, subtitle, cards_json, splash_text')
            .eq('status', 'active')
            .limit(1)
            .single();

        if (error || !drop) {
            return res.status(404).json({ error: 'No hay Drop activo' });
        }

        res.json({
            drop_id: drop.slug,
            title: drop.title,
            subtitle: drop.subtitle,
            cards: drop.cards_json,
            splash: drop.splash_text
        });

    } catch (err) {
        console.error('Active drop error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// API: Start a session (when user taps ENTRAR)
// Returns session_id that the Mini App uses for all subsequent calls
// ================================================================
app.post('/api/session/start', async (req, res) => {
    try {
        const { telegram_user, drop_id, device } = req.body;

        if (!telegram_user?.id) {
            return res.status(400).json({ error: 'Missing telegram_user.id' });
        }

        // 1. Upsert user
        const { data: user, error: userErr } = await supabase
            .from('users')
            .upsert({
                telegram_id: telegram_user.id,
                username: telegram_user.username || null,
                first_name: telegram_user.first_name || null,
            }, { onConflict: 'telegram_id' })
            .select('id')
            .single();

        if (userErr) {
            console.error('User upsert error:', userErr);
            return res.status(500).json({ error: 'Failed to create user' });
        }

        // 2. Check if already completed this drop
        const { data: existing } = await supabase
            .from('drop_sessions')
            .select('id')
            .eq('user_id', user.id)
            .eq('drop_id', drop_id || 'drop_02')
            .not('completed_at', 'is', null)
            .limit(1);

        if (existing?.length > 0) {
            return res.status(409).json({
                error: 'already_completed',
                message: 'Ya jugaste este Drop'
            });
        }

        // 3. Check for incomplete session (resume or create new)
        const { data: incomplete } = await supabase
            .from('drop_sessions')
            .select('id, responses(card_id)')
            .eq('user_id', user.id)
            .eq('drop_id', drop_id || 'drop_02')
            .is('completed_at', null)
            .limit(1);

        let sessionId;

        if (incomplete?.length > 0) {
            // Resume existing incomplete session
            sessionId = incomplete[0].id;
        } else {
            // Create new session
            const { data: session, error: sessErr } = await supabase
                .from('drop_sessions')
                .insert({
                    user_id: user.id,
                    drop_id: drop_id || 'drop_02',
                    started_at: new Date().toISOString(),
                    device_info: device || {}
                })
                .select('id')
                .single();

            if (sessErr) {
                console.error('Session create error:', sessErr);
                return res.status(500).json({ error: 'Failed to create session' });
            }
            sessionId = session.id;
        }

        res.json({
            session_id: sessionId,
            user_id: user.id
        });

    } catch (err) {
        console.error('Session start error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// API: Record a single response (called after EACH card)
// ================================================================
app.post('/api/response', async (req, res) => {
    try {
        const { session_id, card_id, card_format, response_value, latency_ms, trap_passed } = req.body;

        if (!session_id || !card_id) {
            return res.status(400).json({ error: 'Missing session_id or card_id' });
        }

        const { error } = await supabase
            .from('responses')
            .insert({
                session_id,
                card_id,
                card_format,
                response_value,
                latency_ms,
                trap_passed
            });

        if (error) {
            console.error('Response insert error:', error);
            return res.status(500).json({ error: 'Failed to save response' });
        }

        res.json({ ok: true });

    } catch (err) {
        console.error('Response error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// API: Complete a session (called when user finishes all 20 cards)
// ================================================================
app.post('/api/session/complete', async (req, res) => {
    try {
        const { session_id, totals } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'Missing session_id' });
        }

        // 1. Update session as completed
        const { error: sessErr } = await supabase
            .from('drop_sessions')
            .update({
                completed_at: new Date().toISOString(),
                total_cash: totals?.cash || 0,
                total_tickets: totals?.tickets || 0,
                trap_score: totals?.trap_score || 0,
                trap_total: totals?.trap_total || 0
            })
            .eq('id', session_id);

        if (sessErr) {
            console.error('Session complete error:', sessErr);
            return res.status(500).json({ error: 'Failed to complete session' });
        }

        // 2. Get user_id from session
        const { data: session } = await supabase
            .from('drop_sessions')
            .select('user_id')
            .eq('id', session_id)
            .single();

        if (session?.user_id) {
            // 3. Update user totals
            await supabase.rpc('update_user_totals', {
                p_user_id: session.user_id,
                p_cash: totals?.cash || 0,
                p_tickets: totals?.tickets || 0,
                p_trap_score: totals?.trap_score || 0
            });
        }

        res.json({ ok: true, message: 'Drop completado' });

    } catch (err) {
        console.error('Complete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// API: Get rewards for a user
// ================================================================
app.get('/api/rewards/:telegram_id', async (req, res) => {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('total_cash, total_tickets, drops_completed, trap_score')
            .eq('telegram_id', req.params.telegram_id)
            .single();

        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// API: Leaderboard
// ================================================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('first_name, username, total_tickets, total_cash, drops_completed')
            .gt('drops_completed', 0)
            .order('total_tickets', { ascending: false })
            .limit(20);

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// ADMIN API — protegido por header X-Admin-Key
// ================================================================
const ADMIN_KEY = process.env.ADMIN_KEY || 'brutal_admin_2026';

function checkAdmin(req, res, next) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// --- USERS ---

// Lista de usuarios
app.get('/api/admin/users', checkAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, telegram_id, first_name, username, user_status, total_cash, total_tickets, drops_completed, trap_score, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cambiar estado de usuario (approve / reject / pending)
app.post('/api/admin/users/:id/status', checkAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'rejected', 'pending'].includes(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        const { error } = await supabase
            .from('users')
            .update({ user_status: status })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- RESPONSES ---

// Respuestas de un drop específico
app.get('/api/admin/responses/:drop_id', checkAdmin, async (req, res) => {
    try {
        // 1. Obtener sesiones del drop
        const { data: sessions, error: sessErr } = await supabase
            .from('drop_sessions')
            .select('id, user_id, drop_id, started_at, completed_at, total_cash, total_tickets, trap_score, trap_total')
            .eq('drop_id', req.params.drop_id)
            .order('started_at', { ascending: false });

        if (sessErr) throw sessErr;
        if (!sessions || sessions.length === 0) return res.json([]);

        // 2. Obtener users de esas sesiones
        const userIds = [...new Set(sessions.map(s => s.user_id))];
        const { data: users } = await supabase
            .from('users')
            .select('id, telegram_id, first_name, username')
            .in('id', userIds);

        const usersMap = {};
        (users || []).forEach(u => { usersMap[u.id] = u; });

        // 3. Obtener responses de esas sesiones
        const sessionIds = sessions.map(s => s.id);
        const { data: responses } = await supabase
            .from('responses')
            .select('session_id, card_id, card_format, response_value, latency_ms, trap_passed')
            .in('session_id', sessionIds);

        const responsesMap = {};
        (responses || []).forEach(r => {
            if (!responsesMap[r.session_id]) responsesMap[r.session_id] = [];
            responsesMap[r.session_id].push(r);
        });

        // 4. Combinar
        const result = sessions.map(s => ({
            ...s,
            users: usersMap[s.user_id] || { telegram_id: null, first_name: 'Desconocido', username: null },
            responses: responsesMap[s.id] || []
        }));

        res.json(result);
    } catch (err) {
        console.error('Admin responses error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Exportar respuestas anonimizadas de un drop (para análisis con Claude)
app.get('/api/admin/export/:drop_id', checkAdmin, async (req, res) => {
    try {
        const dropId = req.params.drop_id;

        // 1. Obtener el drop con sus cards
        const { data: drop } = await supabase
            .from('drops')
            .select('slug, title, subtitle, cards_json')
            .eq('slug', dropId)
            .single();

        // 2. Obtener sesiones completadas
        const { data: sessions } = await supabase
            .from('drop_sessions')
            .select('id, user_id, started_at, completed_at, total_cash, total_tickets, trap_score, trap_total')
            .eq('drop_id', dropId)
            .not('completed_at', 'is', null)
            .order('started_at', { ascending: true });

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({ error: 'No hay sesiones completadas para este drop' });
        }

        // 3. Obtener responses
        const sessionIds = sessions.map(s => s.id);
        const { data: responses } = await supabase
            .from('responses')
            .select('session_id, card_id, card_format, response_value, latency_ms, trap_passed')
            .in('session_id', sessionIds);

        // 4. Crear hashes anónimos para usuarios (user_01, user_02, etc.)
        const userIds = [...new Set(sessions.map(s => s.user_id))];
        const userMap = {};
        userIds.forEach((uid, i) => {
            userMap[uid] = 'user_' + String(i + 1).padStart(3, '0');
        });

        // 5. Armar responses por sesión
        const responsesMap = {};
        (responses || []).forEach(r => {
            if (!responsesMap[r.session_id]) responsesMap[r.session_id] = [];
            responsesMap[r.session_id].push({
                card_id: r.card_id,
                card_format: r.card_format,
                response_value: r.response_value,
                latency_ms: r.latency_ms,
                trap_passed: r.trap_passed
            });
        });

        // 6. Armar export anonimizado
        const exportData = {
            export_date: new Date().toISOString(),
            drop: {
                slug: drop?.slug || dropId,
                title: drop?.title || 'Unknown',
                subtitle: drop?.subtitle || null,
                cards: drop?.cards_json || []
            },
            summary: {
                total_sessions: sessions.length,
                total_unique_users: userIds.length
            },
            sessions: sessions.map(s => ({
                user_hash: userMap[s.user_id],
                started_at: s.started_at,
                completed_at: s.completed_at,
                duration_seconds: s.completed_at && s.started_at
                    ? Math.round((new Date(s.completed_at) - new Date(s.started_at)) / 1000)
                    : null,
                total_cash: s.total_cash,
                total_tickets: s.total_tickets,
                trap_score: s.trap_score,
                trap_total: s.trap_total,
                responses: (responsesMap[s.id] || []).sort((a, b) => parseInt(a.card_id) - parseInt(b.card_id))
            }))
        };

        res.json(exportData);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- DROPS ---

// Lista de todos los drops
app.get('/api/admin/drops', checkAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('drops')
            .select('id, slug, title, subtitle, status, created_at, activated_at, closed_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Contar sesiones por drop
        for (const drop of data) {
            const { count } = await supabase
                .from('drop_sessions')
                .select('id', { count: 'exact', head: true })
                .eq('drop_id', drop.slug);
            drop.sessions_count = count || 0;
        }

        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Obtener un drop completo (con cards)
app.get('/api/admin/drops/:id', checkAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('drops')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Crear un drop nuevo
app.post('/api/admin/drops', checkAdmin, async (req, res) => {
    try {
        const { slug, title, subtitle, cards_json, splash_text } = req.body;

        if (!slug || !title || !cards_json) {
            return res.status(400).json({ error: 'Faltan campos requeridos (slug, title, cards_json)' });
        }

        const { data, error } = await supabase
            .from('drops')
            .insert({
                slug,
                title,
                subtitle,
                cards_json,
                splash_text: splash_text || null,
                status: 'draft'
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Create drop error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Actualizar un drop (cards, título, etc)
app.put('/api/admin/drops/:id', checkAdmin, async (req, res) => {
    try {
        const updates = {};
        const allowed = ['title', 'subtitle', 'cards_json', 'splash_text'];
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        const { data, error } = await supabase
            .from('drops')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Activar un drop (desactiva el anterior)
app.post('/api/admin/drops/:id/activate', checkAdmin, async (req, res) => {
    try {
        // Desactivar todos los activos
        await supabase
            .from('drops')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .eq('status', 'active');

        // Activar el nuevo
        const { data, error } = await supabase
            .from('drops')
            .update({ status: 'active', activated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// TELEGRAM BOT
// ================================================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUser = msg.from;

    // Upsert user in Supabase
    await supabase.from('users').upsert({
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
    }, { onConflict: 'telegram_id' });

    // Buscar el drop activo para mostrar info dinámica
    const { data: activeDrop } = await supabase
        .from('drops')
        .select('title, subtitle')
        .eq('status', 'active')
        .limit(1)
        .single();

    const dropInfo = activeDrop
        ? `Drop activo: *${activeDrop.title}*`
        : 'No hay Drop activo en este momento.';

    bot.sendMessage(chatId,
        `⚡ *BRUTAL*\n\n` +
        `Bienvenido al club.\n\n` +
        `${dropInfo}\n\n` +
        `/drop — Jugar\n` +
        `/rewards — Tu plata\n` +
        `/leaderboard — Ranking`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '⚡ JUGAR DROP', web_app: { url: WEBAPP_URL + '/index.html' } }
                ]]
            }
        }
    );
});

bot.onText(/\/drop/, async (msg) => {
    // Buscar el drop activo
    const { data: activeDrop } = await supabase
        .from('drops')
        .select('title, subtitle, cards_json')
        .eq('status', 'active')
        .limit(1)
        .single();

    if (!activeDrop) {
        return bot.sendMessage(msg.chat.id, 'No hay Drop activo en este momento. Volvé pronto.');
    }

    const cardCount = activeDrop.cards_json ? activeDrop.cards_json.length : '?';

    bot.sendMessage(msg.chat.id,
        `🎯 *${activeDrop.title}*\n\n${activeDrop.subtitle || cardCount + ' cartas. Cash real.'}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '⚡ EMPEZAR', web_app: { url: WEBAPP_URL + '/index.html' } }
                ]]
            }
        }
    );
});

bot.onText(/\/rewards/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;

    const { data: user } = await supabase
        .from('users')
        .select('total_cash, total_tickets, drops_completed')
        .eq('telegram_id', tgId)
        .single();

    if (!user || user.drops_completed === 0) {
        return bot.sendMessage(chatId, `Todavía no jugaste ningún Drop.\nUsá /drop para empezar.`);
    }

    bot.sendMessage(chatId,
        `💰 *Tu cuenta BRUTAL*\n\n` +
        `Cash: *$${(user.total_cash || 0).toFixed(2)}*\n` +
        `Golden Tickets: *${user.total_tickets || 0}* 🎫\n` +
        `Drops completados: *${user.drops_completed || 0}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/leaderboard/, async (msg) => {
    const chatId = msg.chat.id;

    const { data: leaders } = await supabase
        .from('users')
        .select('first_name, username, total_tickets')
        .gt('drops_completed', 0)
        .order('total_tickets', { ascending: false })
        .limit(10);

    if (!leaders?.length) {
        return bot.sendMessage(chatId, 'Todavía no hay nadie en el leaderboard.\nSé el primero con /drop');
    }

    const medals = ['🥇', '🥈', '🥉'];
    let text = `🏆 *LEADERBOARD BRUTAL*\n\n`;
    leaders.forEach((u, i) => {
        const prefix = medals[i] || `${i + 1}.`;
        const name = u.first_name || u.username || 'Anónimo';
        text += `${prefix} ${name} — *${u.total_tickets}* 🎫\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/reset_leaderboard/, async (msg) => {
    if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, 'No tenés permiso.');
    }

    await supabase
        .from('users')
        .update({ total_cash: 0, total_tickets: 0, drops_completed: 0 })
        .gt('drops_completed', 0);

    bot.sendMessage(msg.chat.id, '✅ Leaderboard reseteado.');
});

bot.onText(/\/replay/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;

    if (!ADMIN_IDS.includes(tgId)) {
        return bot.sendMessage(chatId, 'No tenés permiso.');
    }

    // Buscar el user en Supabase
    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', tgId)
        .single();

    if (!user) {
        return bot.sendMessage(chatId, 'No se encontró tu usuario.');
    }

    // Buscar el drop activo
    const { data: activeDrop } = await supabase
        .from('drops')
        .select('slug')
        .eq('status', 'active')
        .limit(1)
        .single();

    if (!activeDrop) {
        return bot.sendMessage(chatId, 'No hay Drop activo.');
    }

    // Borrar sesiones de este usuario para este drop
    const { error } = await supabase
        .from('drop_sessions')
        .delete()
        .eq('user_id', user.id)
        .eq('drop_id', activeDrop.slug);

    if (error) {
        console.error('Replay delete error:', error);
        return bot.sendMessage(chatId, 'Error al resetear. Revisá los logs.');
    }

    bot.sendMessage(chatId,
        `✅ Sesión borrada para *${activeDrop.slug}*. Podés volver a jugarlo.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '⚡ JUGAR DE NUEVO', web_app: { url: WEBAPP_URL + '/index.html' } }
                ]]
            }
        }
    );
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
    console.log(`BRUTAL API running on port ${PORT}`);
    console.log(`Mini App served at ${WEBAPP_URL}/index.html`);
    console.log(`Bot polling active`);
});
