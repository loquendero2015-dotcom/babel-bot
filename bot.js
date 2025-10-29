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

async function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))
    await fsp.writeFile(DB_FILE, JSON.stringify({ guilds: {} }, null, 2));
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
    db.guilds[guildId] = {
      total: 0,
      meta: DONATION_META_DEFAULT,
      announceChannelId: null,
      lastUpdated: Date.now(),
    };
  }
  return db.guilds[guildId];
}

function hasManageGuild(member) {
  try {
    return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch {
    return false;
  }
}

function formatRemaining(total, meta) {
  return Math.max(meta - total, 0);
}

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
    .setFooter({
      text: channelId
        ? `Anunciando en #${channelId}`
        : "Canal de anuncios no configurado",
    })
    .setTimestamp();
}

// 🧩 Crear cliente
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// 🧩 Manejador de mensajes
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const db = await readDB();
    const state = getGuildState(db, message.guild.id);

    // --- 🏛️ Comandos de la Torre ---
    if (message.content.startsWith("xbabel")) {
      const args = message.content.trim().split(/\s+/);
      const sub = (args[1] || "").toLowerCase();

      if (sub === "status") {
        const embed = buildStatusEmbed(
          message.guild.name,
          state.total,
          state.meta,
          state.announceChannelId
            ? message.guild.channels.cache.get(state.announceChannelId)?.name ||
                state.announceChannelId
            : null
        );
        return message.reply({ embeds: [embed] });
      }

      if (!hasManageGuild(message.member))
        return message.reply("⛔ Necesitás permiso **Manage Server**.");

      if (sub === "set" && args[2]) {
        const val = parseInt(args[2]);
        if (Number.isNaN(val) || val < 0)
          return message.reply("❓ Usá: `xbabel set <numero>`");
        state.total = val;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply(
          `✅ Total establecido en **${state.total}**. Faltan **${formatRemaining(
            state.total,
            state.meta
          )}**.`
        );
      }

      if (sub === "reset") {
        state.total = 0;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply("🧹 Progreso reiniciado.");
      }

      if (sub === "setchannel") {
        const channel = message.mentions.channels.first();
        if (!channel)
          return message.reply("📣 Usá: `xbabel setchannel #canal`");
        state.announceChannelId = channel.id;
        state.lastUpdated = Date.now();
        await writeDB(db);
        return message.reply(`📌 Canal de anuncios establecido en ${channel}.`);
      }

      return message.reply(
        "ℹ️ Comandos: `xbabel status`, `xbabel set <n>`, `xbabel reset`, `xbabel setchannel #canal`"
      );
    }

    // --- 💎 Detección automática de donaciones ---
    const match = message.content.match(
      /^xgift\s+<@!?(\d+)>?\s+(?:"?emp"?|emperium|504)\s*x\s*(\d+)/i
    );
    if (!match) return;

    const amount = parseInt(match[2]);
    if (Number.isNaN(amount) || amount <= 0) return;

    state.total += amount;
    state.lastUpdated = Date.now();
    await writeDB(db);

    const remain = formatRemaining(state.total, state.meta);
    const userTag = message.member ? `${message.member}` : message.author.username;

    // 💬 Mensaje local
    await message.channel.send(
      `💎 ${userTag} donó **${amount}** Emperiums para la Torre de Babel!\n📊 Donados: **${state.total}/${state.meta}** | Faltan: **${remain}**`
    );

    // 📢 Anuncio global si hay canal seteado
    if (state.announceChannelId) {
      const announce = message.guild.channels.cache.get(state.announceChannelId);
      if (announce && announce.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle("💠 Nueva Donación")
          .setDescription(
            `${userTag} ha contribuido con **${amount}** Emperiums para abrir la Torre de Babel.`
          )
          .addFields(
            { name: "Donados", value: `${state.total}`, inline: true },
            { name: "Meta", value: `${state.meta}`, inline: true },
            { name: "Faltan", value: `${remain}`, inline: true }
          )
          .setColor(0xffd700)
          .setTimestamp();
        await announce.send({ embeds: [embed] });
      }
    }

    // 🏛️ Meta alcanzada
    if (state.total >= state.meta) {
      if (state.announceChannelId) {
        const announce = message.guild.channels.cache.get(state.announceChannelId);
        if (announce && announce.isTextBased()) {
          await announce.send(
            "🏛️ **¡LA TORRE DE BABEL SE ABRIÓ!** 🎉\n🔥 Se alcanzaron los **120 Emperiums** necesarios para su apertura.\n✨ ¡Gracias a todos los Nekitos que aportaron, eso rony!"
          );
        }
      }
      state.total = 0;
      state.lastUpdated = Date.now();
      await writeDB(db);
    }
  } catch (err) {
    console.error("🔥 Error general:", err);
  }
});

// 🧩 Cuando el bot está listo
client.once("ready", () => console.log(`✅ Bot listo como ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);

// 🌐 Servidor fantasma para Koyeb ❤️
const app = express();
app.get("/", (req, res) => res.send("✅ Babel Bot is alive and responding!"));
app.get("/health", (req, res) => res.status(200).send("OK"));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () =>
  console.log(`✅ Keepalive server running on port ${PORT}`)
);
setInterval(() => console.log("💤 Ping de vida: Babel Bot sigue activo"), 60000);
