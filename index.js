import express from 'express';
import 'dotenv/config';
import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  Client, GatewayIntentBits, Collection, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder, ButtonStyle, ButtonBuilder
} from 'discord.js';

import cors from 'cors';

// Redis Client & Token Helpers
import {client as redis, getCachedZoomToken, getDailyJoins, saveMessageMap, getMessageMap} from "./redis-client.js";

// MongoDB
import {connectToMongo} from "./mongo-client.js";

await connectToMongo();

// Manual Button Imports (We keep these explicit for now)
import * as zoomRegisterBtn from './buttons/zoomRegister.js';
import * as openEnrollModalBtn from './buttons/openEnrollModal.js';
import {DiscordUser} from "./models/DiscordUser.js";
import {MessageActivity} from "./models/MessageActivity.js";
import {DashBoardLog} from "./models/DashboardLog.js";
import {ZoomLog} from "./models/ZoomLog.js";
import {runRefresh} from "./commands/refresh.js";
import {buildCalendarMessage} from "./commands/calendario.js";

const app = express();

app.use(express.json());

app.use(cors({
  origin: '*'
}))

// ---- DISCORD CLIENT SETUP ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
client.buttons = new Collection();

// 1. DYNAMIC COMMAND LOADER
// This scans your /commands folder and loads everything automatically
const commandsPath = path.join(process.cwd(), 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const fileURL = pathToFileURL(filePath).href;
  const command = await import(fileURL);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  }
}

// 2. REGISTER BUTTONS
client.buttons.set('zoomRegister', zoomRegisterBtn);
client.buttons.set('openEnrollModal', openEnrollModalBtn);

// Helper for functions that need the client to be ready
const clientReady = new Promise((resolve) => {
  client.once('ready', () => {
    console.log(`[${getESTTime()}] - ✅ Logged in as ${client.user.tag}`);
    resolve();
  });
});

// ---- EXPRESS ROUTES ----

// Shared-secret gate for the internal API consumed by the stc-video site.
// Only applied to /api/* routes — the ClickFunnels webhooks above predate it.
function requireApiKey(req, res, next) {
  const provided = req.get('x-api-key');
  if (!process.env.BOT_API_KEY || provided !== process.env.BOT_API_KEY) {
    return res.sendStatus(401);
  }
  next();
}

app.get('/health', (req, res) => {
  const discordStatus = client.isReady() ? 'Connected' : 'Disconnected';
  const uptime = process.uptime();
  res.status(client.isReady() ? 200 : 503).json({
    status: client.isReady() ? 'UP' : 'NOT READY',
    discord: discordStatus,
    uptime: uptime
  });
});

app.post('/webhooks/cf-membership-cancelled', async (req, res) => {
  try {
    const userId = req.body.data.attributes.id;
    const userData = await getUserById(userId);
    const fullName = `${userData.first_name} ${userData.last_name}`;
    const email = userData.email;
    const userOrders = await getUserOrders(userId);
    const isThereAnActiveOrder = userOrders.some(order => order.service_status === "active");

    if (isThereAnActiveOrder) return res.sendStatus(200);

    await kick(userData?.custom_attributes.discord_id, "Membresia cancelada");
    await DashBoardLog.create({
      userId: userData.custom_attributes.discord_id,
      logType: 'clickfunnels',
    });
    console.log(`El usuario ${fullName} (${email}) ha sido eliminado del servidor`);
    res.sendStatus(200);
  } catch (err) {
    console.error('Error en webhook cancelled:', err.message);
    res.sendStatus(500);
  }
});

app.post('/webhooks/discord-enroll', async (req, res) => {
  try {
    const userId = req.body.data.attributes.id;
    const userData = await getUserById(userId);
    const fullName = `${userData.first_name} ${userData.last_name}`;
    const email = userData.email;
    const userOrders = await getUserOrders(userId);
    const isThereAnActiveOrder = userOrders.some(order => order.service_status === "active");

    if (isThereAnActiveOrder) {
      const discordId = await getDiscordIdByUsername(userData.custom_attributes.userdiscord);
      if (discordId === null) throw new Error('Usuario no encontrado en Discord');
      await updateUserAttributes(userId, discordId);
      await giveRole(discordId, process.env.ROLE_ID);
      console.log(`El usuario ${fullName} (${email}) ha sido añadido`);
      res.sendStatus(200);
    } else {
      console.log('no hay orden activa');
      res.sendStatus(200);
    }
  } catch (err) {
    console.error('Error en webhook enroll:', err.message);
    res.sendStatus(500);
  }
});

app.get('/message-map', async (req, res) => {
  try {
    const messageMap = await getMessageMap();
    res.status(200).json(messageMap);
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
});

app.get('/webhooks/discord-info', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID)
    const data = {
      guildName: guild.name,
      memberCount: guild.memberCount
    }
    res.status(200).json(data)
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
})

// Live guild roles for one member. The stc-video site calls this at login and
// once a day per active session, so its access tiers follow Discord instead of
// whatever DiscordUser.roles happened to hold. Returns ids alongside names:
// names drive the tier matching, the id is what the admin check compares.
// 404 means "not in the guild" — the site ends that user's session.
app.get('/api/members/:discordId/roles', requireApiKey, async (req, res) => {
  try {
    const {discordId} = req.params;
    if (!/^\d{15,21}$/.test(discordId)) {
      return res.status(400).json({error: 'invalid_id'});
    }

    await clientReady;
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    let member;
    try {
      member = await guild.members.fetch(discordId);
    } catch (err) {
      // 10007 Unknown Member, 10013 Unknown User
      if (err?.code === 10007 || err?.code === 10013) {
        return res.status(404).json({error: 'not_in_guild'});
      }
      throw err;
    }

    // Unfiltered (@everyone included) to match how guildMemberAdd and
    // sendLogToDb write DiscordUser.roles — the site mirrors this response
    // back into that same field, and differing shapes would churn it.
    const roles = member.roles.cache.map(r => ({id: r.id, name: r.name}));
    res.status(200).json({id: member.id, username: member.user.username, roles});
  } catch (e) {
    console.error('Error en /api/members/:discordId/roles:', e.message);
    res.status(500).json({error: 'internal'});
  }
})

// ---- DISCORD INTERACTION HANDLER ----

client.on('interactionCreate', async interaction => {
  // 1. Slash Commands
  if (interaction.isChatInputCommand()) {
    if (interaction.replied || interaction.deferred) return;
    const command = client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction, {getMeetingDetails, getWeeklySessions}).catch(console.error);
  }

  // 2. Buttons (Handles Metadata for /crear-zoom)
  if (interaction.isButton()) {
    if (interaction.replied || interaction.deferred) return;
    const parts = interaction.customId.split(':');
    const buttonId = parts[0];
    const metadata = parts.slice(1).join(':');
    const button = client.buttons.get(buttonId);
    if (button) {
      await button.execute(interaction, {
        createRegistrant,
        metadata,
        sendLogToDb,
        getMeetingDetails
      }).catch(console.error);
    }
  }

  // 3. Modals

  if (interaction.isModalSubmit()) {
    if (interaction.replied || interaction.deferred) return;
    if (interaction.customId === 'enrollmentModal') {
      await handleEnrollmentModal(interaction);
    }
    if (interaction.customId === 'createZoomModal') {
      await interaction.deferReply();
      const nombre = interaction.fields.getTextInputValue('zoomName');
      const horario = interaction.fields.getTextInputValue('zoomTime');
      const meetingId = interaction.fields.getTextInputValue('zoomId').replace(/\s/g, ''); // Remove spaces

      let timestamp = "";
      try {
        const meeting = await getMeetingDetails(meetingId);
        timestamp = meeting.timestamp;
      } catch (e) {
        console.warn(`Could not fetch meeting details for modal: ${e.message}`);
      }

      const button = new ButtonBuilder()
        .setCustomId(`zoomRegister:${meetingId}:${timestamp}`)
        .setLabel('Registrarse ahora')
        .setStyle(ButtonStyle.Success)
        .setEmoji("📹");

      const embed = new EmbedBuilder()
        .setColor('#2D8CFF')
        .setTitle(`📍 ${nombre}`)
        .addFields(
          {name: '⏰ Horario', value: horario, inline: true},
          {name: '🆔 Meeting ID', value: meetingId, inline: true}
        )
        .setDescription(`Haz clic en el botón de abajo para obtener tu enlace de acceso personal.`)
        .setFooter({text: 'STC Dynamic Zoom System'});

      // Enviar el mensaje al canal donde se usó el comando
      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(button)]
      });
    }

  }

});

async function handleEnrollmentModal(interaction) {
  await interaction.deferReply({ephemeral: true});
  const email = interaction.fields.getTextInputValue('emailInput');
  const discordUser = interaction.user;

  try {
    const userData = await getUserByEmail(email);
    if (!userData) return interaction.editReply(`No se encontró subscripcion activa para: ${email}`);

    const userOrders = await getUserOrders(userData.id);
    const isActive = userOrders.some(order => order.service_status === 'active');
    const existingDiscordId = await checkIfUserIsRegistered(email);

    if (existingDiscordId && existingDiscordId !== discordUser.id) {
      const targetChannel = await interaction.client.channels.fetch('1448045733642113197');
      await targetChannel.send(`@${discordUser.tag} intentó usar el email ${email} ya registrado.`);
      return interaction.editReply(`ALERTA - Contacta con un admin.`);
    }

    if (isActive) {
      await updateUserAttributes(userData.id, discordUser.id);
      await giveRole(discordUser.id, process.env.ROLE_ID);
      await interaction.editReply(` **Excelente!** Verificado correctamente.`);
    } else {
      await interaction.editReply(`No tienes una subscripcion activa.`);
    }
  } catch (e) {
    console.error(e);
    await interaction.editReply(`❌ Error: ${e.message}`);
  }
}

// ---- ZOOM FUNCTIONS ----

async function createRegistrant(name, id, meetingId) {
  const mId = meetingId || process.env.ZOOM_MEETING_ID;
  const redisKey = `user_zoom_link:${id}:${mId}`;
  const cached = await redis.get(redisKey);
  if (cached) return cached;

  const tokens = await getAllZoomTokens();
  let lastError = null;

  for (const {key, token} of tokens) {
    try {
      const url = `https://api.zoom.us/v2/meetings/${mId}/registrants`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({email: `${id}@internal.temp`, first_name: name})
      });

      const data = await safeJson(response, `Zoom (${key}) Failed`);
      await redis.set(redisKey, data.join_url, {EX: 86400});
      return data.join_url;
    } catch (e) {
      console.warn(`Attempt with ${key} failed: ${e.message}`);
      lastError = e;
    }
  }

  throw lastError || new Error('No se pudo registrar en ninguna cuenta de Zoom');
}

async function getZoomAccessToken(prefix = '') {
  const clientId = process.env[`${prefix}ZOOM_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}ZOOM_CLIENT_SECRET`];
  const accountId = process.env[`${prefix}ZOOM_ACCOUNT_ID`];

  if (!clientId || !clientSecret || !accountId) {
    throw new Error(`Missing Zoom credentials for ${prefix || 'STC'}`);
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
    method: 'POST',
    headers: {'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded'}
  });
  const data = await safeJson(response, `Zoom Auth Failed (${prefix || 'STC'})`);
  return data.access_token;
}

async function getAllZoomTokens() {
  const stcToken = await getCachedZoomToken('STC', () => getZoomAccessToken(''));
  const eduToken = await getCachedZoomToken('EDU', () => getZoomAccessToken('EDU_'));
  return [
    {key: 'STC', token: stcToken},
    {key: 'EDU', token: eduToken}
  ];
}

async function getMeetingDetails(meetingId) {
  console.log(`Searching meeting: ${meetingId}`);
  const tokens = await getAllZoomTokens();
  let lastError = null;

  for (const {key, token} of tokens) {
    try {
      const url = `https://api.zoom.us/v2/meetings/${meetingId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
      })

      if (!response.ok) {
        const errorText = await response.text();
        let zoomCode = null;
        try { zoomCode = JSON.parse(errorText)?.code ?? null; } catch {}
        const err = new Error(`Reunión no encontrada o error en ${key}: ${errorText.substring(0, 50)}`);
        err.zoomCode = zoomCode;
        throw err;
      }

      const data = JSON.parse(await response.text());
      console.log(`Meeting found in account: ${key}`);

      let startTime = data.start_time;

      if (data.occurrences && data.occurrences.length > 0) {
        const now = new Date();
        const nextOccurrence = data.occurrences
          .map(occ => ({...occ, startTimeDate: new Date(occ.start_time)}))
          .filter(occ => occ.startTimeDate > now)
          .sort((a, b) => a.startTimeDate - b.startTimeDate)[0];

        if (nextOccurrence) {
          startTime = nextOccurrence.start_time;
        }
      }

      const unixTimestamp = Math.floor(new Date(startTime).getTime() / 1000)
      return {
        topic: data.topic,
        timestamp: unixTimestamp,
        duration: data.duration,
        id: data.id,
      };
    } catch (e) {
      console.warn(`Attempt with ${key} failed: ${e.message}`);
      lastError = e;
    }
  }

  throw lastError || new Error('No se encontró la reunión en ninguna cuenta');
}

// Lists every session in the next `days` days across BOTH Zoom accounts (STC + EDU).
// Only meetings whose topic matches one of `keywords` are included, which filters out
// personal / 1-1 meetings. Recurring meetings (type 8) are expanded into their
// individual occurrences. Returns [{topic, meetingId, account, timestamp}] sorted by time.
async function getWeeklySessions(keywords, days = 7) {
  const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const wanted = keywords.map(normalize);
  const matchesKeyword = (topic) => wanted.some(k => normalize(topic || '').includes(k));

  const now = new Date();
  const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const inWindow = (d) => d > now && d <= windowEnd;

  const tokens = await getAllZoomTokens();
  const sessions = [];
  const seenMeetings = new Set();

  for (const {key, token} of tokens) {
    const headers = {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'};
    try {
      // Account-level (S2S) tokens can't use `me`, so list the account's users first.
      const usersData = await safeJson(
        await fetch('https://api.zoom.us/v2/users?page_size=300', {headers}),
        `Zoom (${key}) users list failed`
      );

      for (const user of usersData.users ?? []) {
        const list = await safeJson(
          await fetch(`https://api.zoom.us/v2/users/${user.id}/meetings?type=upcoming&page_size=300`, {headers}),
          `Zoom (${key}) meetings list failed`
        );

        for (const m of list.meetings ?? []) {
          // type 1 = instantánea, 3 = recurrente sin hora fija, 4 = PMI — no van en el calendario
          if (m.type !== 2 && m.type !== 8) continue;
          if (!matchesKeyword(m.topic)) continue;
          if (seenMeetings.has(m.id)) continue;
          seenMeetings.add(m.id);

          if (m.type === 8) {
            // Recurrente con hora fija: expandir todas las ocurrencias de la semana
            const details = await safeJson(
              await fetch(`https://api.zoom.us/v2/meetings/${m.id}`, {headers}),
              `Zoom (${key}) meeting ${m.id} failed`
            );
            for (const occ of details.occurrences ?? []) {
              const start = new Date(occ.start_time);
              if (inWindow(start)) {
                sessions.push({
                  topic: m.topic,
                  meetingId: m.id,
                  account: key,
                  timestamp: Math.floor(start.getTime() / 1000),
                });
              }
            }
          } else {
            const start = new Date(m.start_time);
            if (inWindow(start)) {
              sessions.push({
                topic: m.topic,
                meetingId: m.id,
                account: key,
                timestamp: Math.floor(start.getTime() / 1000),
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn(`No se pudieron listar las reuniones de ${key}: ${e.message}`);
    }
  }

  return sessions.sort((a, b) => a.timestamp - b.timestamp);
}

// ---- CLICKFUNNELS FUNCTIONS ----

async function getUserById(id) {
  const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/contacts/${id}`, {
    headers: {'Authorization': `Bearer ${process.env.CF2_TOKEN}`, 'accept': 'application/json'}
  });
  return safeJson(res, `Failed to fetch user ${id}`);
}

async function getUserByEmail(email) {
  const url = `https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/workspaces/${process.env.WORKSPACE_ID}/contacts?filter[email_address]=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${process.env.CF2_TOKEN}`,
      'accept': 'application/json'
    }
  });
  const data = await safeJson(res, `Search email failed`);
  return (data && data.length > 0) ? data[0] : null;
}

async function getUserOrders(id) {
  const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/workspaces/${process.env.WORKSPACE_ID}/orders?filter[contact_id]=${id}`, {
    headers: {'Authorization': `Bearer ${process.env.CF2_TOKEN}`, 'accept': 'application/json'}
  });
  return safeJson(res, `Failed to fetch orders`);
}

async function updateUserAttributes(id, discord_id) {
  await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/contacts/${id}`, {
    method: 'PUT',
    headers: {'Authorization': `Bearer ${process.env.CF2_TOKEN}`, 'content-type': 'application/json'},
    body: JSON.stringify({contact: {custom_attributes: {discord_id: discord_id}}})
  });
}

async function checkIfUserIsRegistered(email) {
  const data = await getUserByEmail(email);
  return data?.custom_attributes?.discord_id || false;
}

// ---- DISCORD SERVER FUNCTIONS ----

async function kick(id, reason) {
  try {
    if (!id) throw new Error(`No ID`);
    await clientReady;
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(id);
    await member.kick(reason);
    return true;
  } catch (err) {
    return false;
  }
}

async function getDiscordIdByUsername(username) {
  try {
    await clientReady;
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const members = await guild.members.fetch({query: username, limit: 1});
    return members.first()?.id || null;
  } catch (err) {
    return null;
  }
}

async function giveRole(userId, roleId) {
  try {
    await clientReady;
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId);
    return true;
  } catch (err) {
    return false;
  }
}

// ---- UTILS ----

function getESTTime() {
  return new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour12: false});
}

async function safeJson(response, errorMessage) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${errorMessage}: ${text.substring(0, 100)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${errorMessage}: Invalid JSON`);
  }
}

// ---- STARTUP ----

// Cron job to send daily summary at 23:59 (Central Time)
cron.schedule('59 23 * * *', async () => {
  console.log(`[${getESTTime()}] - Running Daily Zoom Joins Summary...`);
  await sendDailySummary();
}, {
  scheduled: true,
  timezone: "America/Chicago"
});

// Cron job to post the weekly Zoom session calendar every Sunday at 23:00 (Central Time)
cron.schedule('0 23 * * 0', async () => {
  console.log(`[${getESTTime()}] - Running weekly calendar post...`);
  try {
    await clientReady;
    const payload = await buildCalendarMessage(getWeeklySessions);
    if (!payload) {
      console.log('No hay sesiones para el calendario semanal, no se envía nada.');
      return;
    }
    const channel = await client.channels.fetch('1124064907835490535');
    await channel.send(payload);
    console.log(`[${getESTTime()}] - Weekly calendar posted.`);
  } catch (e) {
    console.error(`[${getESTTime()}] - Weekly calendar post failed:`, e.message);
  }
}, {
  scheduled: true,
  timezone: "America/Chicago"
});

// Cron job to auto-refresh the Zoom itinerary every day at midnight (Central Time)
cron.schedule('0 0 * * *', async () => {
  console.log(`[${getESTTime()}] - Running scheduled refresh...`);
  try {
    await clientReady;
    await runRefresh(client, getMeetingDetails);
    console.log(`[${getESTTime()}] - Scheduled refresh completed.`);
  } catch (e) {
    console.error(`[${getESTTime()}] - Scheduled refresh failed:`, e.message);
  }
}, {
  scheduled: true,
  timezone: "America/Chicago"
});

async function sendDailySummary() {
  const dateKey = new Date().toLocaleDateString('en-US', {timeZone: 'America/Chicago'}).replace(/\//g, '-');
  const joins = await getDailyJoins(dateKey);

  if (joins.length === 0) {
    console.log(`No joins for ${dateKey}`);
    return;
  }

  const channelId = process.env.SUMMARY_CHANNEL_ID || '1448045733642113197';
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const summaryEmbed = new EmbedBuilder()
      .setColor('#2D8CFF')
      .setTitle(`📊 Resumen de Registros - ${dateKey}`)
      .setDescription(`Hoy se registraron **${joins.length}** personas a las sesiones de Zoom.`)
      .addFields(
        {name: 'Total de Registros', value: `${joins.length}`, inline: true},
        {
          name: 'Último Registro',
          value: `${joins[joins.length - 1].name} (${new Date(joins[joins.length - 1].timestamp).toLocaleTimeString('en-US', {timeZone: 'America/Chicago'})})`,
          inline: true
        }
      )
      .setTimestamp()
      .setFooter({text: 'STC Analytics'});

    // Optional: List the people
    const peopleList = joins.map(j => `- ${j.name} (${new Date(j.timestamp).toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit'
    })})`).join('\n');
    if (peopleList.length < 1024) {
      summaryEmbed.addFields({name: 'Participantes', value: peopleList});
    } else {
      summaryEmbed.addFields({name: 'Participantes', value: 'Lista demasiado larga para mostrar aquí.'});
    }

    await channel.send({embeds: [summaryEmbed]});
    console.log(`Summary sent for ${dateKey}`);
  } catch (error) {
    console.error('Error sending daily summary:', error);
  }
}

client.once('ready', async () => {
  const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    console.log(`Refreshing ${client.commands.size} commands...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      {body: client.commands.map(c => c.data.toJSON())}
    );
    console.log('✅ Commands Updated!');
  } catch (error) {
    console.error(error);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
app.listen(3001, () => console.log('Server running on port 3000'));


async function sendLogToDb(meetingInfo, member, user) {
  try {
    const userId = user.id;
    const username = member.displayName;
    const roles = member.roles.cache.map(r => r.name);
    const occurredAt = new Date(Number(meetingInfo.timestamp) * 1000);

    let log = await ZoomLog.findOne({ meetingId: meetingInfo.meetingId, occurredAt });
    if (!log) {
      log = await ZoomLog.create({
        meetingId: meetingInfo.meetingId,
        name: meetingInfo.name,
        occurredAt,
        participants: [],
      });
    }

    if (!log.participants.includes(userId)) {
      log.participants.push(userId);
      await log.save();
    }

    const existing = await DiscordUser.findById(userId);
    if (!existing) {
      await DiscordUser.create({
        _id: userId,
        username,
        roles,
        previousUsernames: [],
      });
    } else {
      const updates = {};
      if (existing.username !== username) {
        updates.$push = { previousUsernames: existing.username };
        updates.$set = { username };
      }
      if (roles) {
        updates.$set = { ...updates.$set, roles };
      }
      if (Object.keys(updates).length > 0) {
        await DiscordUser.findByIdAndUpdate(userId, updates);
      }
    }

    await DashBoardLog.findOneAndUpdate(
      { userId, zoomLogId: log._id, logType: ['zoom-register'] },
      {
        $inc: { count: 1 },
        $setOnInsert: { occurredAt: new Date() },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error(e);
  }
}


client.on('messageCreate', message => {
  if (message.author.bot) return;
  //this is fire and forget, let's not await it just to improve speed.
  DiscordUser.updateOne({
    _id: message.author.id,
  }, {$inc: {messageCount: 1}}).catch(console.error);

  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  MessageActivity.updateOne(
    { userId: message.author.id, date, channelId: message.channelId },
    {
      $inc: { count: 1, charSum: message.content.length },
      $set: {
        lastMessageAt: new Date(),
        channelName: message.channel.name,
      },
    },
    { upsert: true }
  ).catch(console.error);
})

// Stamp removedAt when someone leaves or is kicked. Fire-and-forget — we don't
// want a slow DB write to block gateway events.
client.on('guildMemberRemove', member => {
  DiscordUser.updateOne(
    { _id: member.id },
    { $set: { removedAt: new Date() } }
  ).catch(console.error);
});

// Role changes made after join never reached the DB before this, so a member
// promoted to Alpha kept the old roles until they next triggered a write. The
// stc-video site reads DiscordUser.roles at login, so keep it current here.
client.on('guildMemberUpdate', (oldMember, newMember) => {
  if (oldMember.roles.cache.equals(newMember.roles.cache)) return;

  DiscordUser.updateOne(
    { _id: newMember.id },
    { $set: { roles: newMember.roles.cache.map(r => r.name) } }
  ).catch(console.error);
});

// When someone joins (or rejoins), upsert the full profile so brand-new members
// land in the DB immediately with username, role names, avatar, and join date.
client.on('guildMemberAdd', member => {
  DiscordUser.updateOne(
    { _id: member.id },
    {
      $set: {
        username: member.user.username,
        roles: member.roles.cache.map(r => r.name),
        avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
        joinedAt: member.joinedAt ?? new Date(),
        removedAt: null,
      },
      $setOnInsert: { previousUsernames: [] },
    },
    { upsert: true }
  ).catch(console.error);
});

