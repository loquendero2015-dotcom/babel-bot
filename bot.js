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
            ? (message.guild.channels.cache.get(state.announceChannelId)?.name || state.announceChannelId)
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
    const match = message.content.match(/^xgift\s+<@!?(\d+)>?\s+(?:"?emp"?|emperium|504)\s*x\s*(\d+)/i);
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
          .setDescription(`${userTag} ha contribuido con **${amount}** Emperiums para abrir la Torre de Babel.`)
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
