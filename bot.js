// Nekotina – Contador de Emperiums para Torre de Babel
// discord.js v14 – Node 18+
// Autor: Misato para Nico ❤️

import dotenv from "dotenv";
dotenv.config();

import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField
} from "discord.js";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

// __dirname para ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== Config ======
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "babel.json");
const DONATION_META_DEFAULT = 120;
const DONATION_WINDOW_MS = 90 * 1000; // más margen
const NEKOTINA_BOT_ID = process.env.NEKOTINA_BOT_ID || null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

// ====== DB ======
async function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) await fsp.writeFile(DB_FILE, JSON.stringify({ guilds: {} }, null, 2));
}
async function readDB() { await ensureDB(); return JSON.parse(await fsp.readFile(DB_FILE, "utf8")); }
async function writeDB(data) { await fsp.writeFile(DB_FILE, JSON.stringify(data, null, 2)); }
function getGuildState(db, guildId) {
  if (!db.guilds[guildId])
    db.guilds[guildId] = { total: 0, meta: DONATION_META_DEFAULT, announceChannelId: null, lastUpdated: Date.now() };
  return db.guilds[guildId];
}

// ====== Helpers ======
function hasManageGuild(member) {
  try { return member.permissions.has(PermissionsBitField.Flags.ManageGuild); } catch { return false; }
}
function formatRemaining(total, meta) { return Math.max(meta - total, 0); }
function buildStatusEmbed(guildName, total, meta, channelName) {
  const remain = formatRemaining(total, meta);
  return new EmbedBuilder()
    .setTitle("🏛️ Torre de Babel – Progreso")
    .setDescription(`Servidor: **${guildName}**`)
    .addFields(
      { name: "Donados", value: `${total} Emperiums`, inline: true },
      { name: "Meta", value: `${meta} Emperiums`, inline: true },
      { name: "Faltan", value: `${remain} Emperiums`, inline: true }
    )
    .setFooter({ text: channelName ? `Anunciando en #${channelName}` : "Canal de anuncios no configurado" })
    .setTimestamp();
}

// ====== Anti-dupe por mensaje (por si el proceso registra 2 veces el listener) ======
const handledMessages = new Set();
const HANDLED_TTL_MS = 10 * 1000;
setInterval(() => {
  // el Set no guarda timestamps, pero con TTL corto y GC manual evitamos acumulación en sesiones largas
  if (handledMessages.size > 5000) handledMessages.clear();
}, 60 * 1000);
function markHandled(msgId) {
  handledMessages.add(msgId);
  setTimeout(() => handledMessages.delete(msgId), HANDLED_TTL_MS);
}

// ====== Pendientes de donación ======
const pending = new Map(); // key: channelId:userId -> { amount, at }
function pendingKey(channelId, userId) { return `${channelId}:${userId}`; }
setInterval(() => {
  const now = Date.now();
  for (const [key, p] of pending.entries()) {
    if (now - p.at > DONATION_WINDOW_MS) pending.delete(key);
  }
}, 30 * 1000);

// ====== Regexs flexibles ======
// Acepta cualquier cosa entre xgift y el item; solo nos importa el "x <numero>" después del item.
const DONATION_CMD = /(^|\s)xgift\b[\s\S]*?\b(?:emperium|emp|504)\b[\s*]*x\s*(\d+)/i;

// Palabras clave de éxito/fracaso (flex)
const SUCCESS_TOKENS = [
  "sacrificado",          // "Tu item ha sido sacrificado..."
  "emperium",             // menciona el item
  "¿has visto aquella torre", // frase típica de evento torre
  "torre por las montañas"
];
const FAIL_TOKENS = [
  "supera la que posees",
  "no posees ese item"
];

// ====== ÚNICO listener ======
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;

    // Anti-dupe por seguridad
    if (handledMessages.has(message.id)) return;
    markHandled(message.id);

    // ---------- Comandos xbabel ----------
    if (!message.author.bot && message.content.startsWith("xbabel")) {
      const db = await readDB();
      const state = getGuildState(db, message.guild.id);
      const args = message.content.trim().split(/\s+/);
      const sub = (args[1] || "").toLowerCase();

      if (sub === "status") {
        const channelName = state.announceChannelId
          ? (message.guild.channels.cache.get(state.announceChannelId)?.name || "Canal desconocido")
          : null;
        const embed = buildStatusEmbed(message.guild.name, state.total, state.meta, channelName);
        await message.reply({ embeds: [embed] });
        return;
      }

      if (!hasManageGuild(message.member)) {
        await message.reply("⛔ Necesitás permiso **Manage Server**.");
        return;
      }

      if (sub === "set" && args[2]) {
        const val = parseInt(args[2], 10);
        if (Number.isNaN(val) || val < 0) { await message.reply("❓ Usá: `xbabel set <numero>`"); return; }
        state.total = val;
        state.lastUpdated = Date.now();
        await writeDB(db);
        await message.reply(`✅ Total establecido en **${state.total}**. Faltan **${formatRemaining(state.total, state.meta)}**.`);
        return;
      }

      if (sub === "reset") {
        state.total = 0;
        state.lastUpdated = Date.now();
        await writeDB(db);
        await message.reply("🧹 Progreso reiniciado.");
        return;
      }

      if (sub === "setchannel") {
        const channel = message.mentions.channels.first();
        if (!channel) { await message.reply("📣 Usá: `xbabel setchannel #canal`"); return; }
        state.announceChannelId = channel.id;
        state.lastUpdated = Date.now();
        await writeDB(db);
        await message.reply(`📌 Canal de anuncios establecido en ${channel}.`);
        return;
      }

      await message.reply("ℹ️ Comandos: `xbabel status`, `xbabel set <n>`, `xbabel reset`, `xbabel setchannel #canal`");
      return;
    }

    // ---------- Captura de xgift (pendiente) ----------
    if (!message.author.bot && /(^|\s)xgift\b/i.test(message.content)) {
      const m = message.content.match(DONATION_CMD);
      if (m) {
        const amount = parseInt(m[2] || m[1], 10); // por si el grupo cae en 1 o 2 según el match
        if (!Number.isNaN(amount) && amount > 0) {
          const key = pendingKey(message.channel.id, message.author.id);
          pending.set(key, { amount, at: Date.now() });
          await message.react("⏳");
        }
      }
      return;
    }

    // ---------- Confirmación de Nekotina (u otro bot) ----------
    if (message.author.bot) {
      // Si configuraste el ID del bot de Nekotina, filtramos por él; si no, aceptamos cualquier bot.
      if (NEKOTINA_BOT_ID && message.author.id !== NEKOTINA_BOT_ID) return;

      const clean = message.content.replace(/<:[^>]+>/g, "").toLowerCase().trim();
      const isSuccess = SUCCESS_TOKENS.some(t => clean.includes(t));
      const isFail    = FAIL_TOKENS.some(t => clean.includes(t));
      if (!isSuccess && !isFail) return;

      // Buscar el pending más reciente de este canal dentro de la ventana
      const keys = [...pending.keys()].filter(k => k.startsWith(`${message.channel.id}:`));
      if (keys.length === 0) return;

      const now = Date.now();
      let bestKey = null, bestAt = 0;
      for (const k of keys) {
        const p = pending.get(k);
        if (p && (now - p.at) <= DONATION_WINDOW_MS && p.at > bestAt) {
          bestAt = p.at; bestKey = k;
        }
      }
      if (!bestKey) return;

      const p = pending.get(bestKey);
      pending.delete(bestKey);

      const [channelId, userId] = bestKey.split(":");
      const guild = message.guild;
      const channel = guild.channels.cache.get(channelId);

      if (isFail) {
        if (channel) {
          const user = await guild.members.fetch(userId).catch(() => null);
          if (user) await channel.send(`❌ ${user}: no se pudo donar (error del bot).`);
        }
        return;
      }

      if (isSuccess) {
        const db = await readDB();
        const state = getGuildState(db, guild.id);

        state.total += p.amount;
        state.lastUpdated = Date.now();
        await writeDB(db);

        const remain = formatRemaining(state.total, state.meta);
        const user = await guild.members.fetch(userId).catch(() => null);
        const userTag = user ? `${user}` : `<@${userId}>`;

        if (channel) {
          await channel.send(
            `💎 ${userTag} aportó **${p.amount}** Emperiums para la Torre de Babel!\n` +
            `📊 Donados: **${state.total}/${state.meta}** | Faltan: **${remain}**`
          );
        }

        if (state.announceChannelId) {
          const announce = guild.channels.cache.get(state.announceChannelId);
          if (announce && announce.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle("💠 Nueva Donación")
              .setDescription(`${userTag} ha contribuido con **${p.amount}** Emperiums.`)
              .addFields(
                { name: "Donados", value: `${state.total}`, inline: true },
                { name: "Meta", value: `${state.meta}`, inline: true },
                { name: "Faltan", value: `${remain}`, inline: true }
              )
              .setColor(0xFFD700)
              .setTimestamp();
            await announce.send({ embeds: [embed] });
          }
        }

        // Si alcanzó o superó la meta → anunciar y resetear contador
        if (state.total >= state.meta) {
          if (state.announceChannelId) {
            const announce = guild.channels.cache.get(state.announceChannelId);
            if (announce && announce.isTextBased()) {
              await announce.send(
                "🏛️ **¡LA TORRE DE BABEL SE ABRIÓ!** 🎉\n" +
                `🔥 Se alcanzaron los **${state.meta} Emperiums** necesarios para su apertura.\n` +
                "✨ ¡Gracias a todos los Nekitos que aportaron, eso rony!"
              );
            }
          }
          state.total = 0;
          state.lastUpdated = Date.now();
          await writeDB(db);
        }
      }
    }
  } catch (err) {
    console.error("Error general:", err);
  }
});

client.once("ready", () => console.log(`✅ Bot listo como ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);

// ====== Keepalive para Koyeb/Render/etc. ======
const app = express();
app.get("/", (_, res) => res.send("✅ Babel Bot is alive and responding!"));
app.get("/health", (_, res) => res.status(200).send("OK"));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Keepalive en puerto ${PORT}`));
setInterval(() => console.log("💤 Ping de vida: Babel Bot sigue activo"), 60000);
