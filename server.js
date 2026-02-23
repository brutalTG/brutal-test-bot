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

// EL PARCHE: Limpiamos la URL por si termina en barra (/) en tu .env
const RAW_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const WEBAPP_URL = RAW_URL.endsWith('/') ? RAW_URL.slice(0, -1) : RAW_URL;

const ADMIN_KEY = process.env.ADMIN_KEY || 'brutal_admin_2026';
const ADMIN_TG_ID = 6949935917;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('ERROR: Faltan SUPABASE_URL o SUPABASE_KEY'); process.exit(1); }
if (!BOT_TOKEN) { console.error('ERROR: Falta BOT_TOKEN'); process.exit(1); }

// ================================================================
// INIT
// ================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Mantenemos la orden de leer la carpeta public
app.use(express.static(path.join(__dirname, 'public'))); 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('BRUTAL API starting...');

// ================================================================
// ADMIN AUTH MIDDLEWARE
// ================================================================
function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ================================================================
// HEALTH CHECK
// ================================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ================================================================
// DEBUG: ESCÁNER DE ARCHIVOS
// ================================================================
app.get('/api/debug', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    try {
        const rootFiles = fs.readdirSync(__dirname);
        let publicFiles = [];
        try {
            publicFiles = fs.readdirSync(path.join(__dirname, 'public'));
        } catch (e) {
            publicFiles = ['ERROR: LA CARPETA PUBLIC NO EXISTE ACÁ'];
        }
        res.json({ 
            directorio_actual: __dirname,
            archivos_raiz: rootFiles, 
            archivos_en_public: publicFiles 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ================================================================
// PUBLIC: Get active drop
// ================================================================
app.get('/api/drop/active', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('drops')
            .select('id, slug, title, cards_json, splash_text, status')
            .eq('status', 'active')
            .limit(1)
            .single();

        if (error || !data) return res.status(404).json({ error: 'No active drop found' });

        res.json({
            id: data.id,
            slug: data.slug,
            title: data.title,
            cards: typeof data.cards_json === 'string' ? JSON.parse(data.cards_json) : data.cards_json,
            splash_text: data.splash_text || null
        });
    } catch (err) {
        console.error('Drop active error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// PUBLIC: Start a session
// ================================================================
app.post('/api/session/start', async (req, res) => {
    try {
        const { telegram_user, drop_id, device } = req.body;
        if (!telegram_user?.id) return res.status(400).json({ error: 'Missing telegram_user.id' });

        const { error: userErr } = await supabase
            .from('users')
            .upsert({ telegram_id: telegram_user.id, username: telegram_user.username || null, first_name: telegram_user.first_name || null }, { onConflict: 'telegram_id' });
        if (userErr) console.error('User upsert error:', userErr);

        const { data: existing } = await supabase
            .from('drop_sessions')
            .select('id, completed_at')
            .eq('user_id', telegram_user.id)
            .eq('drop_id', drop_id || 'drop_02')
            .not('completed_at', 'is', null);

        if (existing && existing.length > 0) return res.status(409).json({ error: 'already_completed', message: 'Ya completaste este Drop.' });

        const { data: incomplete } = await supabase
            .from('drop_sessions')
            .select('id')
            .eq('user_id', telegram_user.id)
            .eq('drop_id', drop_id || 'drop_02')
            .is('completed_at', null);

        if (incomplete && incomplete.length > 0) return res.json({ session_id: incomplete[0].id, resumed: true });

        const { data: session, error: sessErr } = await supabase
            .from('drop_sessions')
            .insert({ user_id: telegram_user.id, drop_id: drop_id || 'drop_02', device_info: device || {}, started_at: new Date().toISOString() })
            .select('id')
            .single();

        if (sessErr) { console.error('Session create error:', sessErr); return res.status(500).json({ error: 'Failed to create session' }); }
        res.json({ session_id: session.id });
    } catch (err) {
        console.error('Session start error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// PUBLIC: Save a response
// ================================================================
app.post('/api/response', async (req, res) => {
    try {
        const { session_id, card_id, card_format, response_value, latency_ms, trap_passed } = req.body;
        if (!session_id || !card_id) return res.status(400).json({ error: 'Missing session_id or card_id' });

        const { error } = await supabase
            .from('responses')
            .insert({ session_id, card_id, card_format, response_value, latency_ms, trap_passed });

        if (error) { console.error('Response insert error:', error); return res.status(500).json({ error: 'Failed to save response' }); }
        res.json({ ok: true });
    } catch (err) {
        console.error('Response error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// PUBLIC: Complete a session
// ================================================================
app.post('/api/session/complete', async (req, res) => {
    try {
        const { session_id, totals } = req.body;
        if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

        const { error: sessErr } = await supabase
            .from('drop_sessions')
            .update({ completed_at: new Date().toISOString(), total_cash: totals?.cash || 0, total_tickets: totals?.tickets || 0, trap_score: totals?.trap_score || 0, trap_total: totals?.trap_total || 0 })
            .eq('id', session_id);

        if (sessErr) { console.error('Session complete error:', sessErr); return res.status(500).json({ error: 'Failed to complete session' }); }

        const { data: session } = await supabase.from('drop_sessions').select('user_id').eq('id', session_id).single();
        if (session?.user_id) {
            await supabase.rpc('update_user_totals', { p_user_id: session.user_id, p_cash: totals?.cash || 0, p_tickets: totals?.tickets || 0, p_trap_score: totals?.trap_score || 0 });
        }

        res.json({ ok: true, message: 'Drop completado' });
    } catch (err) {
        console.error('Complete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ================================================================
// PUBLIC: Get rewards
// ================================================================
app.get('/api/rewards/:telegram_id', async (req, res) => {
    try {
        const { data: user } = await supabase.from('users').select('total_cash, total_tickets, drops_completed, trap_score').eq('telegram_id', req.params.telegram_id).single();
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// PUBLIC: Leaderboard
// ================================================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data, error } = await supabase.from('users').select('first_name, username, total_tickets, total_cash, drops_completed').gt('drops_completed', 0).order('total_tickets', { ascending: false }).limit(20);
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ================================================================
// ADMIN: List users
// ================================================================
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, telegram_id, username, first_name, user_status, total_cash, total_tickets, drops_completed, trap_score, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// ================================================================
// ADMIN: Change user status
// ================================================================
app.post('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'pending', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const { error } = await supabase.from('users').update({ user_status: status }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin status error:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// ================================================================
// ADMIN: List drops
// ================================================================
app.get('/api/admin/drops', requireAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('drops')
            .select('id, slug, title, subtitle, status, cards_json, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;

        const result = [];
        for (const d of (data || [])) {
            const { count } = await supabase.from('drop_sessions').select('id', { count: 'exact', head: true }).eq('drop_id', d.slug);
            result.push({ ...d, sessions_count: count || 0 });
        }
        res.json(result);
    } catch (err) {
        console.error('Admin drops error:', err);
        res.status(500).json({ error: 'Failed to load drops' });
    }
});

// ================================================================
// ADMIN: Get single drop
// ================================================================
app.get('/api/admin/drops/:id', requireAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase.from('drops').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: 'Drop not found' });
        res.json(data);
    } catch (err) {
        console.error('Admin drop get error:', err);
        res.status(500).json({ error: 'Failed to load drop' });
    }
});

// ================================================================
// ADMIN: Create drop
// ================================================================
app.post('/api/admin/drops', requireAdmin, async (req, res) => {
    try {
        const { slug, title, subtitle, cards_json } = req.body;
        if (!slug) return res.status(400).json({ error: 'Slug is required' });
        const { data, error } = await supabase
            .from('drops')
            .insert({ slug, title: title || null, subtitle: subtitle || null, cards_json: cards_json || [], status: 'draft' })
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Admin drop create error:', err);
        res.status(500).json({ error: 'Failed to create drop' });
    }
});

// ================================================================
// ADMIN: Update drop
// ================================================================
app.put('/api/admin/drops/:id', requireAdmin, async (req, res) => {
    try {
        const { title, subtitle, cards_json } = req.body;
        const update = {};
        if (title !== undefined) update.title = title;
        if (subtitle !== undefined) update.subtitle = subtitle;
        if (cards_json !== undefined) update.cards_json = cards_json;
        const { error } = await supabase.from('drops').update(update).eq('id', req.params.id);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin drop update error:', err);
        res.status(500).json({ error: 'Failed to update drop' });
    }
});

// ================================================================
// ADMIN: Activate drop
// ================================================================
app.post('/api/admin/drops/:id/activate', requireAdmin, async (req, res) => {
    try {
        await supabase.from('drops').update({ status: 'inactive' }).eq('status', 'active');
        const { error } = await supabase.from('drops').update({ status: 'active' }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin activate error:', err);
        res.status(500).json({ error: 'Failed to activate drop' });
    }
});

// ================================================================
// ADMIN: Get responses for a drop
// ================================================================
app.get('/api/admin/responses/:dropId', requireAdmin, async (req, res) => {
    try {
        const { data: sessions, error } = await supabase
            .from('drop_sessions')
            .select('id, user_id, drop_id, started_at, completed_at, total_cash, total_tickets, trap_score, trap_total')
            .eq('drop_id', req.params.dropId)
            .order('started_at', { ascending: false });

        if (error) throw error;
        if (!sessions || !sessions.length) return res.json([]);

        const result = [];
        for (const s of sessions) {
            const [{ data: responses }, { data: user }] = await Promise.all([
                supabase.from('responses').select('card_id, card_format, response_value, latency_ms, trap_passed').eq('session_id', s.id).order('created_at', { ascending: true }),
                supabase.from('users').select('first_name, username').eq('telegram_id', s.user_id).single()
            ]);
            result.push({ ...s, users: user || {}, responses: responses || [] });
        }
        res.json(result);
    } catch (err) {
        console.error('Admin responses error:', err);
        res.status(500).json({ error: 'Failed to load responses' });
    }
});

// ================================================================
// ADMIN: Export anonymized data
// ================================================================
app.get('/api/admin/export/:dropId', requireAdmin, async (req, res) => {
    try {
        const { data: sessions, error } = await supabase
            .from('drop_sessions')
            .select('id, started_at, completed_at, total_cash, total_tickets, trap_score, trap_total')
            .eq('drop_id', req.params.dropId)
            .order('started_at', { ascending: false });

        if (error) throw error;
        const result = [];
        let anonCounter = 1;
        for (const s of (sessions || [])) {
            const { data: responses } = await supabase.from('responses').select('card_id, card_format, response_value, latency_ms, trap_passed').eq('session_id', s.id).order('created_at', { ascending: true });
            result.push({ anon_id: `user_${String(anonCounter++).padStart(3, '0')}`, started_at: s.started_at, completed_at: s.completed_at, total_cash: s.total_cash, total_tickets: s.total_tickets, trap_score: s.trap_score, trap_total: s.trap_total, responses: responses || [] });
        }
        res.json({ drop_id: req.params.dropId, exported_at: new Date().toISOString(), summary: { total_sessions: result.length, completed: result.filter(r => r.completed_at).length }, sessions: result });
    } catch (err) {
        console.error('Admin export error:', err);
        res.status(500).json({ error: 'Failed to export' });
    }
});

// ================================================================
// TELEGRAM BOT
// ================================================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUser = msg.from;
    await supabase.from('users').upsert({ telegram_id: tgUser.id, username: tgUser.username || null, first_name: tgUser.first_name || null }, { onConflict: 'telegram_id' });
    bot.sendMessage(chatId, `⚡ *BRUTAL*\n\nBienvenido al club.\n\nCada semana lanzamos un *Drop*: 20 preguntas rápidas.\nRespondés → ganás cash + golden tickets.\nHay trampas. Si caés, perdés.\n\n/drop — Jugar\n/rewards — Tu plata\n/leaderboard — Ranking`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⚡ JUGAR DROP', web_app: { url: WEBAPP_URL + '/index.html' } }]] } });
});

bot.onText(/\/drop/, async (msg) => {
    bot.sendMessage(msg.chat.id, `🎯 *Drop activo*\n\n20 cartas. ~3 minutos. Cash real.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⚡ EMPEZAR', web_app: { url: WEBAPP_URL + '/index.html' } }]] } });
});

bot.onText(/\/rewards/, async (msg) => {
    const { data: user } = await supabase.from('users').select('total_cash, total_tickets, drops_completed').eq('telegram_id', msg.from.id).single();
    if (!user || user.drops_completed === 0) return bot.sendMessage(msg.chat.id, `Todavía no jugaste ningún Drop.\nUsá /drop para empezar.`);
    bot.sendMessage(msg.chat.id, `💰 *Tu cuenta BRUTAL*\n\nCash: *$${(user.total_cash || 0).toFixed(2)}*\nGolden Tickets: *${user.total_tickets || 0}* 🎫\nDrops completados: *${user.drops_completed || 0}*`, { parse_mode: 'Markdown' });
});

bot.onText(/\/leaderboard/, async (msg) => {
    const { data: leaders } = await supabase.from('users').select('first_name, username, total_tickets').gt('drops_completed', 0).order('total_tickets', { ascending: false }).limit(10);
    if (!leaders?.length) return bot.sendMessage(msg.chat.id, 'Todavía no hay nadie en el leaderboard.\nSé el primero con /drop');
    const medals = ['🥇', '🥈', '🥉'];
    let text = `🏆 *LEADERBOARD BRUTAL*\n\n`;
    leaders.forEach((u, i) => { text += `${medals[i] || `${i+1}.`} ${u.first_name || u.username || 'Anónimo'} — *${u.total_tickets}* 🎫\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/replay/, async (msg) => {
    if (msg.from.id !== ADMIN_TG_ID) return bot.sendMessage(msg.chat.id, 'No tenés permiso.');
    const { error } = await supabase.from('drop_sessions').delete().eq('user_id', msg.from.id);
    bot.sendMessage(msg.chat.id, error ? '❌ Error' : '✅ Sesiones borradas. Podés rejugar.');
});

bot.onText(/\/reset_leaderboard/, async (msg) => {
    if (msg.from.id !== ADMIN_TG_ID) return bot.sendMessage(msg.chat.id, 'No tenés permiso.');
    await supabase.from('users').update({ total_cash: 0, total_tickets: 0, drops_completed: 0 }).gt('drops_completed', 0);
    bot.sendMessage(msg.chat.id, '✅ Leaderboard reseteado.');
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
    console.log(`BRUTAL API running on port ${PORT}`);
    console.log(`Mini App: ${WEBAPP_URL}/index.html`);
    console.log(`Admin: ${WEBAPP_URL}/admin.html`);
    console.log(`Bot polling active`);
});
