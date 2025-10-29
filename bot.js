// Nekotina – Contador de Emperiums para Torre de Babel
// discord.js v14 – Node 18+
// Autor: Misato para Nico ❤️

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'babel.json');
const DONATION_META_DEFAULT = 120;
const DONATION_WINDOW_MS = 60 * 1000;
const NEKOTINA_BOT_ID = process.env.NEKOTINA_BOT_ID || null;

const MSG_SUCCESS = 'Tu item ha sido sacrificado a los dioses nekitos.';
const MSG_FAIL_1 = 'La cantidad que intentas regalar supera la que posees en tu mochila.';
const MSG_FAIL_2 = 'No posees ese item en tu mochila.';

const DONATION_CMD = /^xgift\s+<@!?\d+>\s+(?:\"emp\"|emperium|emp|504)\s*x\s*(\d+)\b/i;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

async function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) await fsp.writeFile(DB_FILE, JSON.stringify({ guilds: {} }, null, 2));
}

async function readDB() {
  await ensureDB();
  const raw = await fsp.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeDB(data) {
  await ensureDB();
  await fsp.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function getGuildState(db, guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = { total: 0, meta: DONATION_META_DEFAULT, announceChannelId: null, lastUpdated: Date.now() };
  }
  return db.guilds[guildId];
}

const pending = new Map();
function pendingKey(channelId, userId) { return `${channelId}:${userId}`; }
function cleanupPending() {
  const now = Date.now();
  for (const [key, p] of pending.entries()) {
    if (now - p.at > DONATION_WINDOW_MS) pending.delete(key);
  }
}
setInterval(cleanupPending, 30 * 1000);

function hasManageGuild(member) {
  try { return member.permissions.has(PermissionsBitField.Flags.ManageGuild); } catch { return false; }
}
function formatRemaining(total, meta) { return Math.max(meta - total, 0); }
function buildStatusEmbed(guildName, total, meta, channelId) {
  const remain = formatRemaining(total, meta);
  return new EmbedBuilder()
    .setTitle('🏛️ Torre de Babel – Progreso')
    .setDescription(`Servidor: **${guildName}**`)
    .addFields(
      { name: 'Donados', value: `${total} Emperiums`, inline: true },
      { name: 'Meta', value: `${meta} Emperiums`, inline: true },
      { name: 'Faltan', value: `${remain} Emperiums`, inline: true },
    )
    .setFooter({ text: channelId ? `Anunciando en #${channelId}` : 'Canal de anuncios no configurado' })
    .setTimestamp();
}

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const db = await readDB();
    const state = getGuildState(db, message.guild.id);

    if (message.content.startsWith('xbabel')) {
      const args = message.content.trim().split(/\s+/);
      const sub = (args[1] || '').toLowerCase();

      if (sub === 'status') {
        const embed = buildStatusEmbed(message.guild.name, state.total, state.meta, state.announceChannelId ? (message.guild.channels.cache.get(state.announceChannelId)?.name || state.announceChannelId) : null);
        return message.reply({ embeds: [embed] });
      }

      if (!hasManageGuild(message.member)) return message.reply('⛔ Necesitás permiso **Manage Server**.');

      if (sub === 'set' && args[2]) {
        const val = parseInt(args[2]);
        if (Number.isNaN(val) || val < 0) return message.reply('❓ Usá: `xbabel set <numero>`');
        state.total = val; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply(`✅ Total establecido en **${state.total}**. Faltan **${formatRemaining(state.total, state.meta)}**.`);
      }
      if (sub === 'reset') {
        state.total = 0; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply('🧹 Progreso reiniciado.');
      }
      if (sub === 'setchannel') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('📣 Usá: `xbabel setchannel #canal`');
        state.announceChannelId = channel.id; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply(`📌 Canal de anuncios establecido en ${channel}.`);
      }
      return message.reply('ℹ️ Comandos: `xbabel status`, `xbabel set <n>`, `xbabel reset`, `xbabel setchannel #canal`');
    }

    if (message.content.toLowerCase().startsWith('xgift')) {
      if (!message.mentions.users || message.mentions.users.size === 0) return;
      const m = message.content.match(DONATION_CMD);
      if (!m) return;
      const amount = parseInt(m[1]);
      if (Number.isNaN(amount) || amount <= 0) return;
      const key = pendingKey(message.channel.id, message.author.id);
      pending.set(key, { amount, at: Date.now() });
      await message.react('⏳');
      return;
    }
  } catch (err) { console.error('Error (parte 1):', err); }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return;
    const fromKnownNekotina = NEKOTINA_BOT_ID && message.author?.id === NEKOTINA_BOT_ID;
    const fromAnyBot = message.author?.bot === true;
    if (!(fromKnownNekotina || fromAnyBot)) return;

    const content = message.content?.trim();
    if (!content) return;
    const isSuccess = content === MSG_SUCCESS;
    const isFail = content === MSG_FAIL_1 || content === MSG_FAIL_2;
    if (!isSuccess && !isFail) return;

    const keys = [...pending.keys()].filter(k => k.startsWith(`${message.channel.id}:`));
    if (keys.length === 0) return;
    const now = Date.now();
    let bestKey = null, bestAt = 0;
    for (const k of keys) {
      const p = pending.get(k);
      if (!p) continue;
      if (now - p.at <= DONATION_WINDOW_MS && p.at > bestAt) { bestAt = p.at; bestKey = k; }
    }
    if (!bestKey) return;

    const p = pending.get(bestKey);
    const [channelId, userId] = bestKey.split(':');
    const guild = message.guild;
    const channel = guild.channels.cache.get(channelId);
    const db = await readDB();
    const state = getGuildState(db, guild.id);

    if (isFail) {
      pending.delete(bestKey);
      if (channel) {
        const user = await guild.members.fetch(userId).catch(() => null);
        if (user) await channel.send(`❌ ${user}: no se pudo donar (error del bot).`);
      }
      return;
    }

    if (isSuccess) {
      state.total += p.amount; state.lastUpdated = Date.now(); await writeDB(db);
      const remain = formatRemaining(state.total, state.meta);
      const user = await guild.members.fetch(userId).catch(() => null);
      const userTag = user ? `${user}` : `<@${userId}>`;
      if (channel) await channel.send(`✅ ${userTag} Donaste **${p.amount}** emperiums para la torre de babel, eso rony. Quedan **${remain}**.`);
      if (state.announceChannelId) {
        const announce = guild.channels.cache.get(state.announceChannelId);
        if (announce && announce.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('💎 Nueva donación a la Torre de Babel')
            .setDescription(`Se ha confirmado una donación de **${p.amount}** Emperiums.`)
            .addFields(
              { name: 'Total acumulado', value: `${state.total}/${state.meta}`, inline: true },
              { name: 'Faltan', value: `${remain}`, inline: true }
            )
            .setTimestamp();
          await announce.send({ embeds: [embed] });
        }
      }
      pending.delete(bestKey);
    }
  } catch (err) { console.error('Error (parte 2):', err); }
});

client.once('ready', () => console.log(`✅ Bot listo como ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
// 🌐 Servidor fantasma para Koyeb ❤️
import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.send("✅ Babel Bot is alive and responding!");
});

// Endpoint específico para Koyeb health checks
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

  res.send("✅ Babel Bot is alive and responding!");
});

// Forzamos que el servidor se quede escuchando incluso si Koyeb tarda
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Keepalive server running on port ${PORT}`));
  console.log("✅ Keepalive server running on port", process.env.PORT || 8000);
});

// Pequeño keep-alive para mantener conexión activa con Discord
setInterval(() => console.log("💤 Ping de vida: Babel Bot sigue activo"), 60000);
