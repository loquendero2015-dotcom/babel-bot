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

// Simular __dirname para módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "babel.json");
const DONATION_META_DEFAULT = 120;
const DONATION_WINDOW_MS = 60 * 1000;
const NEKOTINA_BOT_ID = process.env.NEKOTINA_BOT_ID || null;

const MSG_SUCCESS = "Tu item ha sido sacrificado a los dioses nekitos.";
const MSG_FAIL_1 = "La cantidad que intentas regalar supera la que posees en tu mochila.";
const MSG_FAIL_2 = "No posees ese item en tu mochila.";

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
  const raw = await fsp.readFile(DB_FILE, "utf8");
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
    .setTitle("🏛️ Torre de Babel – Progreso")
    .setDescription(`Servidor: **${guildName}**`)
    .addFields(
      { name: "Donados", value: `${total} Emperiums`, inline: true },
      { name: "Meta", value: `${meta} Emperiums`, inline: true },
      { name: "Faltan", value: `${remain} Emperiums`, inline: true }
    )
    .setFooter({ text: channelId ? `Anunciando en #${channelId}` : "Canal de anuncios no configurado" })
    .setTimestamp();
}

// 🧩 Detección de comandos
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const db = await readDB();
    const state = getGuildState(db, message.guild.id);

    if (message.content.startsWith("xbabel")) {
      const args = message.content.trim().split(/\s+/);
      const sub = (args[1] || "").toLowerCase();

      if (sub === "status") {
        const embed = buildStatusEmbed(message.guild.name, state.total, state.meta, state.announceChannelId ? (message.guild.channels.cache.get(state.announceChannelId)?.name || state.announceChannelId) : null);
        return message.reply({ embeds: [embed] });
      }

      if (!hasManageGuild(message.member)) return message.reply("⛔ Necesitás permiso **Manage Server**.");

      if (sub === "set" && args[2]) {
        const val = parseInt(args[2]);
        if (Number.isNaN(val) || val < 0) return message.reply("❓ Usá: `xbabel set <numero>`");
        state.total = val; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply(`✅ Total establecido en **${state.total}**. Faltan **${formatRemaining(state.total, state.meta)}**.`);
      }
      if (sub === "reset") {
        state.total = 0; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply("🧹 Progreso reiniciado.");
      }
      if (sub === "setchannel") {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply("📣 Usá: `xbabel setchannel #canal`");
        state.announceChannelId = channel.id; state.lastUpdated = Date.now(); await writeDB(db);
        return message.reply(`📌 Canal de anuncios establecido en ${channel}.`);
      }
      return message.reply("ℹ️ Comandos: `xbabel status`, `xbabel set <n>`, `xbabel reset`, `xbabel setchannel #canal`");
    }

    if (message.content.toLowerCase().startsWith("xgift")) {
      if (!message.mentions.users || message.mentions.users.size === 0) return;
      const m = message.content.match(DONATION_CMD);
      if (!m) return;
      const amount = parseInt(m[1]);
      if (Number.isNaN(amount) || amount <= 0) return;
      const key = pendingKey(message.channel.id, message.author.id);
      pending.set(key, { amount, at: Date.now() });
      await message.react("⏳");
      return;
    }
  } catch (err) { console.error("Error (parte 1):", err); }
});

// 🧩 Confirmación de donaciones
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    const fromKnownNekotina = NEKOTINA_BOT_ID && message.author?.id === NEKOTINA_BOT_ID;
    const fromAnyBot = message.author?.bot === true;
    if (!(fromKnownNekotina || fromAnyBot)) return;

    const content = message.content?.trim();
    if (!content) return;
    // 💬 Detección flexible de mensajes de Nekotina (aunque tenga emojis)
const cleanContent = content.replace(/<:[^>]+>/g, "").trim(); // elimina emojis tipo <:algo:1234>
const isSuccess = cleanContent.includes("Tu item ha sido sacrificado a los dioses nekitos");
const isFail = cleanContent.includes("La cantidad que intentas regalar supera la que posees") ||
               cleanContent.includes("No posees ese item en tu mochila");
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
    const [channelId, userId] = bestKey.split(":");
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
      state.total += p.amount;
      state.lastUpdated = Date.now();
      await writeDB(db);

      const remain = formatRemaining(state.total, state.meta);
      const user = await guild.members.fetch(userId).catch(() => null);
      const userTag = user ? `${user}` : `<@${userId}>`;

      if (channel) {
        await channel.send(
          `💎 ${userTag} aportó **${p.amount}** Emperiums para la apertura de la Torre de Babel!\n` +
          `📊 Donados: **${state.total}/${state.meta}** | Faltan: **${remain}**`
        );
      }

      if (state.announceChannelId) {
        const announce = guild.channels.cache.get(state.announceChannelId);
        if (announce && announce.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle("💠 Nueva Donación")
            .setDescription(`${userTag} ha contribuido con **${p.amount}** Emperiums para abrir la Torre de Babel.`)
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

      // 🏛️ Si alcanzó o superó la meta
      if (state.total >= state.meta) {
        if (state.announceChannelId) {
          const announce = guild.channels.cache.get(state.announceChannelId);
          if (announce && announce.isTextBased()) {
            await announce.send(
              "🏛️ **¡LA TORRE DE BABEL SE ABRIÓ!** 🎉\n" +
              "🔥 Se alcanzaron los **120 Emperiums** necesarios para su apertura.\n" +
              "✨ ¡Gracias a todos los Nekitos que aportaron, eso rony!"
            );
          }
        }
        state.total = 0;
        state.lastUpdated = Date.now();
        await writeDB(db);
      }

      pending.delete(bestKey);
    }
  } catch (err) { console.error("Error (parte 2):", err); }
});

client.once("ready", () => console.log(`✅ Bot listo como ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);

// 🌐 Servidor fantasma para Koyeb ❤️
const app = express();
app.get("/", (req, res) => res.send("✅ Babel Bot is alive and responding!"));
app.get("/health", (req, res) => res.status(200).send("OK"));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Keepalive server running on port ${PORT}`));
setInterval(() => console.log("💤 Ping de vida: Babel Bot sigue activo"), 60000);
