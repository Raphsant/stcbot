import {
  SlashCommandBuilder, ButtonBuilder, ActionRowBuilder,
  EmbedBuilder, ButtonStyle, AttachmentBuilder
} from 'discord.js';

import {getMessageMap, removeMessageMapEntry} from "../redis-client.js";


export const data = new SlashCommandBuilder()
.setName('refresh')
.setDescription('Actualiza el itinerario en base a tu agenda de zoom.')

export async function runRefresh(client, getMeetingDetails) {
  const guild = await client.guilds.fetch('512330980011278336');
  const messageMap = await getMessageMap();

  for (const message of messageMap) {
    try {
      const channel = await guild.channels.fetch(message.channelId);
      const targetMessage = await channel.messages.fetch(message.messageId);
      const meeting = await getMeetingDetails(message.meetingId);
      const timeString = `<t:${meeting.timestamp}:F>\n🕒 **Inicia:** <t:${meeting.timestamp}:R>`;
      const logo = new AttachmentBuilder('./img/stclogo.jpeg');
      const button = new ButtonBuilder()
        .setCustomId(`zoomRegister:${meeting.id}:${meeting.timestamp}`)
        .setLabel('Obtener Enlace de Acceso')
        .setStyle(ButtonStyle.Success)
        .setEmoji("📹");

      const embed = new EmbedBuilder()
        .setColor('#2D8CFF')
        .setTitle(`📍 ${meeting.topic}`)
        .addFields(
          {name: '📅 Horario Local', value: timeString, inline: false},
        )
        .setDescription(`Esta sesión está programada en Zoom. Haz clic abajo para registrarte y obtener tu enlace único.`)
        .setThumbnail('attachment://stclogo.jpeg')
        .setFooter({text: 'Sincronizado automáticamente con Zoom API'});

      await targetMessage.edit({embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], files: [logo]});
    } catch (err) {
      // Discord: 10008 = Unknown Message, 10003 = Unknown Channel
      // Zoom:    3001  = Meeting does not exist
      // In all cases the entry is stale, drop it and move on.
      if (err?.code === 10008 || err?.code === 10003 || err?.zoomCode === 3001) {
        const reason = err?.zoomCode === 3001 ? `zoom 3001` : `discord ${err.code}`;
        console.warn(`Removing stale messageMap entry (${reason}): channel=${message.channelId} message=${message.messageId} meeting=${message.meetingId}`);
        await removeMessageMapEntry(message.messageId, message.meetingId, message.channelId);
        continue;
      }
      throw err;
    }
  }
}

export async function execute(interaction, {getMeetingDetails}){
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({ content: 'No tienes permisos.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    await runRefresh(interaction.client, getMeetingDetails);
    await interaction.editReply({content: 'Itinerario actualizado', ephemeral: true});
  } catch (e) {
    console.error(e);
    await interaction.editReply(`**Error:** ${e.message}`);
  }
}
