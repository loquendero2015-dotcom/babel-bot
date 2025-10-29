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

// Simular __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "babel.json");
const DONATION_META_DEFAULT = 120;
const DONATION_WINDOW_MS = 60 * 1000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

// 🧠 DB
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

// 🔄 Pendientes
const pending = new Map();
function pendingKey(channelId, userId) { return `${channelId}:${userId}`; }
setInterval(() => {
  const now = Date.now();
  for (const [key, p] of pending.entries()) {
    if (now - p.at > DONATION_WINDOW_MS) pending.delete(key);
  }
}, 30000);

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

// 💬 Evento principal (uno solo)
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;

    // --- 📜 comandos xbabel ---
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
        return message.reply({ embeds: [embed] });
      }

      if (!hasManageGuild(message.member))
        return message.reply("⛔ Necesitás permiso **Manage Server**.");

      if (sub === "set" && args[2]) {
        const val = parseInt(args[2]);
        if (Number.isNaN(val) || val < 0) return message.reply("❓ Usá: `xbabel set <numero>`");
        state.total = val;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply(`✅ Total establecido en **${state.total}**. Faltan **${formatRemaining(state.total, state.meta)}**.`);
      }

      if (sub === "reset") {
        state.total = 0;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply("🧹 Progreso reiniciado.");
      }

      if (sub === "setchannel") {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply("📣 Usá: `xbabel setchannel #canal`");
        state.announceChannelId = channel.id;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply(`📌 Canal de anuncios establecido en ${channel}.`);
      }

      return message.reply("ℹ️ Comandos: `xbabel status`, `xbabel set <n>`, `xbabel reset`, `xbabel setchannel #canal`");
    }

    // --- 💎 Detección de xgift ---
    if (!message.author.bot && message.content.toLowerCase().startsWith("xgift")) {
      const DONATION_CMD = /^xgift\s+@?\w+\s+.*?(?:emperium|emp|504)\s*x\s*(\d+)/i;
      const m = message.content.match(DONATION_CMD);
      if (!m) return;
      const amount = parseInt(m[1]);
      if (Number.isNaN(amount) || amount <= 0) return;
      const key = pendingKey(message.channel.id, message.author.id);
      pending.set(key, { amount, at: Date.now() });
      await message.react("⏳");
      return;
    }

    // --- 🤖 Mensajes de Nekotina ---
    if (message.author.bot) {
      const clean = message.content.replace(/<:[^>]+>/g, "").toLowerCase().trim();

      // Detección flexible
      const isSuccess =
        clean.includes("sacrificado") ||
        clean.includes("emperium") ||
        clean.includes("¿has visto aquella torre") ||
        clean.includes("torre por las montañas");

      const isFail =
        clean.includes("supera la que posees") ||
        clean.includes("no posees ese item");

      if (!isSuccess && !isFail) return;

      const keys = [...pending.keys()].filter(k => k.startsWith(`${message.channel.id}:`));
      if (keys.length === 0) return;

      const now = Date.now();
      let bestKey = null, bestAt = 0;
      for (const k of keys) {
        const p = pending.get(k);
        if (p && now - p.at <= DONATION_WINDOW_MS && p.at > bestAt) {
          bestAt = p.at;
          bestKey = k;
        }
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
          await writeDB(db);
        }

        pending.delete(bestKey);
      }
    }
  } catch (err) {
    console.error("Error general:", err);
  }
});

client.once("ready", () => console.log(`✅ Bot listo como ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);

// 🌐 Keepalive
const app = express();
app.get("/", (req, res) => res.send("✅ Babel Bot is alive and responding!"));
app.listen(process.env.PORT || 8000, () => console.log("✅ Keepalive activo"));
setInterval(() => console.log("💤 Ping de vida: Babel Bot sigue activo"), 60000);
