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
const ADMIN_IDS = []; // Poné tu Telegram User ID acá, ej: [123456789]

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

    bot.sendMessage(chatId,
        `⚡ *BRUTAL*\n\n` +
        `Bienvenido al club.\n\n` +
        `Cada semana lanzamos un *Drop*: 20 preguntas rápidas.\n` +
        `Respondés → ganás cash + golden tickets.\n` +
        `Hay trampas. Si caés, perdés.\n\n` +
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
    bot.sendMessage(msg.chat.id,
        `🎯 *Drop #02 — Verdad, Deseo y Performance*\n\n20 cartas. ~3 minutos. Cash real.`,
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

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
    console.log(`BRUTAL API running on port ${PORT}`);
    console.log(`Mini App served at ${WEBAPP_URL}/index.html`);
    console.log(`Bot polling active`);
});
