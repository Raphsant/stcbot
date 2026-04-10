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

// Redis Client & Token Helpers
import {client as redis, getCachedZoomToken, getDailyJoins, saveMessageMap, getMessageMap} from "./redis-client.js";

// Manual Button Imports (We keep these explicit for now)
import * as zoomRegisterBtn from './buttons/zoomRegister.js';
import * as openEnrollModalBtn from './buttons/openEnrollModal.js';

const app = express();
app.use(express.json());

// ---- DISCORD CLIENT SETUP ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
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

app.get('/webhooks/discord-info', async (req,res) => {
  try{
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

// ---- DISCORD INTERACTION HANDLER ----

client.on('interactionCreate', async interaction => {
  // 1. Slash Commands
  if (interaction.isChatInputCommand()) {
    if (interaction.replied || interaction.deferred) return;
    const command = client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction, {getMeetingDetails}).catch(console.error);
  }

  // 2. Buttons (Handles Metadata for /crear-zoom)
  if (interaction.isButton()) {
    if (interaction.replied || interaction.deferred) return;
    const parts = interaction.customId.split(':');
    const buttonId = parts[0];
    const metadata = parts.slice(1).join(':'); 
    const button = client.buttons.get(buttonId);
    if (button) {
      await button.execute(interaction, {createRegistrant, metadata, sendLogToDb, getMeetingDetails}).catch(console.error);
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
        throw new Error(`Reunión no encontrada o error en ${key}: ${errorText.substring(0, 50)}`);
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
  const body = {
    meetingId: meetingInfo.meetingId,
    startTime: meetingInfo.timestamp,
    name: meetingInfo.name,
    discordUser: {
      id: user.id,
      username: member.displayName,
      roles: member.roles.cache.map(r => r.name),
    }
  }
  console.log(body);
  const res = await fetch('https://stc-front.netlify.app/api/logs/meeting', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  console.log(res);


}


