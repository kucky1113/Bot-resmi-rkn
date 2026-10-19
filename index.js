// RKN || REPUBLIC OF INDONESIA - Discord Bot
// Dependensi: discord.js v14, dotenv

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  REST,
  Routes,
} = require('discord.js');

// ===================== KONFIGURASI =====================
const DATA_FILE = path.join(__dirname, 'data.json');
const SPAM_WINDOW = 5000; // ms
const SPAM_LIMIT = 5;     // jumlah pesan dalam SPAM_WINDOW sebelum di-timeout
const SPAM_TIMEOUT_MIN = 5;
const LINK_REGEX = /(https?:\/\/|www\.|discord\.gg\/)\S+/i;

// ===================== PENYIMPANAN =====================
// Pengaturan disimpan per server (guild) di data.json
const store = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  : {};

function gcfg(guildId) {
  if (!store[guildId]) {
    store[guildId] = { raidmode: false, antilink: false, antispam: false, blacklist: [] };
  }
  return store[guildId];
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

const spamMap = new Map(); // key: guildId:userId -> array timestamp

// ===================== DEFINISI COMMAND =====================
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Cek latensi bot'),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Menampilkan informasi server'),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Beri timeout kepada member')
    .addUserOption((o) => o.setName('user').setDescription('Member yang di-timeout').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('durasi').setDescription('Durasi dalam menit (1-40320)').setRequired(true).setMinValue(1).setMaxValue(40320)
    )
    .addStringOption((o) => o.setName('alasan').setDescription('Alasan timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Tambah atau hapus role dari member')
    .addSubcommand((s) =>
      s.setName('add').setDescription('Tambah role ke member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Hapus role dari member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Hapus pesan dalam channel')
    .addIntegerOption((o) =>
      o.setName('jumlah').setDescription('Jumlah pesan (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .addUserOption((o) => o.setName('user').setDescription('Hanya hapus pesan dari user ini'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('raidmode')
    .setDescription('Aktif/nonaktifkan raidmode (member baru otomatis di-kick)')
    .addBooleanOption((o) => o.setName('aktif').setDescription('Nyalakan atau matikan').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('antilink')
    .setDescription('Aktif/nonaktifkan anti-link')
    .addBooleanOption((o) => o.setName('aktif').setDescription('Nyalakan atau matikan').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('blacklist-add')
    .setDescription('Tambah kata ke blacklist')
    .addStringOption((o) => o.setName('kata').setDescription('Kata yang dilarang').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('blacklist-remove')
    .setDescription('Hapus kata dari blacklist')
    .addStringOption((o) => o.setName('kata').setDescription('Kata yang dihapus').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('blacklist-list')
    .setDescription('Lihat daftar kata terlarang')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Kirim pengumuman dalam bentuk embed')
    .addStringOption((o) => o.setName('pesan').setDescription('Isi pengumuman').setRequired(true))
    .addStringOption((o) => o.setName('judul').setDescription('Judul pengumuman'))
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel tujuan (default: channel ini)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('emblem')
    .setDescription('Menampilkan emblem (icon) dan banner server'),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Bot mengirim pesan atas nama bot')
    .addStringOption((o) => o.setName('pesan').setDescription('Isi pesan').setRequired(true))
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel tujuan (default: channel ini)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Aktif/nonaktifkan anti-spam')
    .addBooleanOption((o) => o.setName('aktif').setDescription('Nyalakan atau matikan').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('security')
    .setDescription('Menampilkan status keamanan server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

// ===================== CLIENT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ===================== HELPER =====================
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

// Pemilik server selalu boleh; selain itu role tertinggi harus lebih tinggi dari target
function canActOnMember(issuer, target, guild) {
  if (guild.ownerId === issuer.id) return true;
  return issuer.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

function canActOnRole(issuer, role, guild) {
  if (guild.ownerId === issuer.id) return true;
  return issuer.roles.highest.position > role.position;
}

async function toggleSetting(i, key, label) {
  const cfg = gcfg(i.guildId);
  cfg[key] = i.options.getBoolean('aktif');
  saveData();
  return i.reply(`✅ ${label} **${cfg[key] ? 'AKTIF' : 'NONAKTIF'}**.`);
}

// ===================== HANDLER COMMAND =====================
const handlers = {
  async ping(i) {
    return i.reply(`🏓 Pong! Latensi WebSocket: **${i.client.ws.ping}ms**`);
  },

  async serverinfo(i) {
    const g = i.guild;
    const embed = new EmbedBuilder()
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }))
      .setColor(0x2b6cb0)
      .addFields(
        { name: 'ID Server', value: g.id, inline: true },
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Member', value: String(g.memberCount), inline: true },
        { name: 'Dibuat', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Channel', value: String(g.channels.cache.size), inline: true },
        { name: 'Role', value: String(g.roles.cache.size), inline: true },
        { name: 'Boost', value: `Level ${g.premiumTier} (${g.premiumSubscriptionCount ?? 0} boost)`, inline: true }
      );
    return i.reply({ embeds: [embed] });
  },

  async timeout(i) {
    const target = i.options.getMember('user');
    const menit = i.options.getInteger('durasi');
    const alasan = i.options.getString('alasan') ?? 'Tidak ada alasan';

    if (!target) return i.reply(ephemeral('Member tidak ditemukan di server.'));
    if (!canActOnMember(i.member, target, i.guild))
      return i.reply(ephemeral('Role kamu tidak cukup tinggi untuk men-timeout member ini.'));
    if (!target.moderatable)
      return i.reply(ephemeral('Bot tidak punya izin untuk men-timeout member ini.'));

    await target.timeout(menit * 60 * 1000, alasan);
    return i.reply(`⏳ ${target.user.tag} di-timeout selama **${menit} menit**.\nAlasan: ${alasan}`);
  },

  async role(i) {
    const sub = i.options.getSubcommand();
    const target = i.options.getMember('user');
    const role = i.options.getRole('role');

    if (!target) return i.reply(ephemeral('Member tidak ditemukan di server.'));
    if (!role.editable) return i.reply(ephemeral('Bot tidak bisa mengatur role ini.'));
    if (!canActOnRole(i.member, role, i.guild))
      return i.reply(ephemeral('Role kamu tidak cukup tinggi untuk mengatur role ini.'));

    if (sub === 'add') {
      await target.roles.add(role);
      return i.reply(`➕ Role ${role} ditambahkan ke ${target}.`);
    }
    await target.roles.remove(role);
    return i.reply(`➖ Role ${role} dihapus dari ${target}.`);
  },

  async purge(i) {
    const jumlah = i.options.getInteger('jumlah');
    const user = i.options.getUser('user');

    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const fetched = await i.channel.messages.fetch({ limit: 100 });
    let msgs = [...fetched.values()];
    if (user) msgs = msgs.filter((m) => m.author.id === user.id);
    msgs = msgs.slice(0, jumlah);

    // filterOld = true: pesan lebih dari 14 hari tidak bisa di-bulk delete
    const deleted = await i.channel.bulkDelete(msgs, true);
    return i.editReply(`🧹 ${deleted.size} pesan berhasil dihapus.`);
  },

  async raidmode(i) {
    return toggleSetting(i, 'raidmode', '🛡️ Raidmode');
  },

  async antilink(i) {
    return toggleSetting(i, 'antilink', '🔗 Anti-link');
  },

  async 'blacklist-add'(i) {
    const kata = i.options.getString('kata').toLowerCase().trim();
    const cfg = gcfg(i.guildId);
    if (cfg.blacklist.includes(kata))
      return i.reply(ephemeral(`Kata \`${kata}\` sudah ada di blacklist.`));
    cfg.blacklist.push(kata);
    saveData();
    return i.reply(`🚫 Kata \`${kata}\` ditambahkan ke blacklist.`);
  },

  async 'blacklist-remove'(i) {
    const kata = i.options.getString('kata').toLowerCase().trim();
    const cfg = gcfg(i.guildId);
    if (!cfg.blacklist.includes(kata))
      return i.reply(ephemeral(`Kata \`${kata}\` tidak ada di blacklist.`));
    cfg.blacklist = cfg.blacklist.filter((w) => w !== kata);
    saveData();
    return i.reply(`✅ Kata \`${kata}\` dihapus dari blacklist.`);
  },

  async 'blacklist-list'(i) {
    const list = gcfg(i.guildId).blacklist;
    if (list.length === 0) return i.reply(ephemeral('Blacklist masih kosong.'));
    const text = list.map((w, n) => `${n + 1}. ${w}`).join('\n').slice(0, 3900);
    const embed = new EmbedBuilder()
      .setTitle('📋 Daftar Blacklist')
      .setDescription('```\n' + text + '\n```')
      .setColor(0xe74c3c)
      .setFooter({ text: `Total: ${list.length} kata` });
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async announcement(i) {
    const pesan = i.options.getString('pesan');
    const judul = i.options.getString('judul') ?? '📢 Pengumuman';
    const channel = i.options.getChannel('channel') ?? i.channel;

    const embed = new EmbedBuilder()
      .setTitle(judul)
      .setDescription(pesan)
      .setColor(0xf1c40f)
      .setFooter({ text: `Oleh ${i.user.tag}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    return i.reply(ephemeral(`Pengumuman terkirim ke <#${channel.id}>.`));
  },

  async emblem(i) {
    const g = i.guild;
    const icon = g.iconURL({ size: 1024, extension: 'png' });
    if (!icon) return i.reply(ephemeral('Server ini belum memiliki emblem (icon).'));

    const embed = new EmbedBuilder()
      .setTitle(`Emblem ${g.name}`)
      .setThumbnail(icon)
      .setImage(icon)
      .setColor(0x2b6cb0);

    const banner = g.bannerURL({ size: 1024 });
    if (banner) embed.addFields({ name: 'Banner', value: `[Lihat banner](${banner})` });

    return i.reply({ embeds: [embed] });
  },

  async say(i) {
    const pesan = i.options.getString('pesan');
    const channel = i.options.getChannel('channel') ?? i.channel;
    // allowedMentions kosong: bot tidak bisa dipakai untuk mention @everyone/@here
    await channel.send({ content: pesan, allowedMentions: { parse: [] } });
    return i.reply(ephemeral(`Pesan terkirim ke <#${channel.id}>.`));
  },

  async antispam(i) {
    return toggleSetting(i, 'antispam', '🌊 Anti-spam');
  },

  async security(i) {
    const cfg = gcfg(i.guildId);
    const botPerms = i.guild.members.me.permissions;
    const required = {
      'Kelola Pesan': PermissionFlagsBits.ManageMessages,
      'Timeout Member': PermissionFlagsBits.ModerateMembers,
      'Kelola Role': PermissionFlagsBits.ManageRoles,
      'Kick Member': PermissionFlagsBits.KickMembers,
    };
    const missing = Object.entries(required)
      .filter(([, flag]) => !botPerms.has(flag))
      .map(([name]) => name);

    const status = (on) => (on ? '🟢 Aktif' : '🔴 Nonaktif');
    const embed = new EmbedBuilder()
      .setTitle('🔐 Status Keamanan Server')
      .setColor(0x27ae60)
      .addFields(
        { name: 'Raidmode', value: status(cfg.raidmode), inline: true },
        { name: 'Anti-link', value: status(cfg.antilink), inline: true },
        { name: 'Anti-spam', value: status(cfg.antispam), inline: true },
        { name: 'Blacklist', value: `${cfg.blacklist.length} kata`, inline: true },
        {
          name: 'Izin Bot',
          value: missing.length ? `⚠️ Kurang: ${missing.join(', ')}` : '✅ Lengkap',
        }
      )
      .setTimestamp();
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

// ===================== EVENT =====================
client.once(Events.ClientReady, async (c) => {
  console.log(`Login sebagai ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild())
    return interaction.reply(ephemeral('Command ini hanya bisa dipakai di dalam server.'));

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err);
    const msg = ephemeral(`❌ Terjadi error: ${err.message}`);
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

// Raidmode: member baru langsung di-kick
client.on(Events.GuildMemberAdd, async (member) => {
  if (!store[member.guild.id]?.raidmode) return;
  if (member.kickable) {
    await member.kick('Raidmode aktif').catch(() => {});
    console.log(`[RAIDMODE] Kick ${member.user.tag} di ${member.guild.name}`);
  }
});

// Anti-link, blacklist, dan anti-spam
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  const cfg = store[msg.guild.id];
  if (!cfg) return;

  // Admin & moderator (Kelola Pesan) dikecualikan dari filter
  const member = msg.member;
  if (!member || member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const warn = async (reason) => {
    const notice = await msg.channel.send(`${msg.author}, ${reason}`).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);
  };

  try {
    const content = msg.content ?? '';

    if (cfg.antilink && LINK_REGEX.test(content)) {
      await msg.delete().catch(() => {});
      return warn('dilarang mengirim link.');
    }

    if (cfg.blacklist.length) {
      const lower = content.toLowerCase();
      if (cfg.blacklist.some((w) => lower.includes(w))) {
        await msg.delete().catch(() => {});
        return warn('pesan mengandung kata yang dilarang.');
      }
    }

    if (cfg.antispam) {
      const key = `${msg.guild.id}:${msg.author.id}`;
      const now = Date.now();
      const times = (spamMap.get(key) ?? []).filter((t) => now - t < SPAM_WINDOW);
      times.push(now);
      spamMap.set(key, times);

      if (times.length >= SPAM_LIMIT) {
        spamMap.delete(key);
        if (member.moderatable) {
          await member.timeout(SPAM_TIMEOUT_MIN * 60 * 1000, 'Anti-spam').catch(() => {});
        }
        await warn(`terdeteksi spam dan di-timeout ${SPAM_TIMEOUT_MIN} menit.`);
      }
    }
  } catch (err) {
    console.error('[MessageCreate]', err);
  }
});

// ===================== REGISTRASI COMMAND =====================
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  await rest.put(route, { body: commands });
  console.log(
    process.env.GUILD_ID
      ? `${commands.length} slash command terdaftar (server tertentu)`
      : `${commands.length} slash command terdaftar (global, bisa butuh ~1 jam)`
  );
}

client.login(process.env.TOKEN);
