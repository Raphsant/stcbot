import {
  SlashCommandBuilder, ButtonBuilder, ActionRowBuilder,
  EmbedBuilder, ButtonStyle, AttachmentBuilder
} from 'discord.js';

import {client as redis, getCachedZoomToken, getDailyJoins, saveMessageMap, getMessageMap} from "../redis-client.js";




export const data = new SlashCommandBuilder()
.setName('refresh')
.setDescription('Actualiza el itinerario en base a tu agenda de zoom.')

export async function execute(interaction, {getMeetingDetails}){
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({ content: 'No tienes permisos.', ephemeral: true });
  }
  await interaction.deferReply()

  try{
    const guild = await interaction.client.guilds.fetch('512330980011278336')
    const channel = await guild.channels.fetch("1448045733642113197")
    const messageMap = await getMessageMap()
    for(const message of messageMap){
      const targetMessage = await channel.messages.fetch(message.messageId)
      const meeting = await getMeetingDetails(message.meetingId);
      const timeString = `<t:${meeting.timestamp}:F>\n🕒 **Inicia:** <t:${meeting.timestamp}:R>`;
      const logo = new AttachmentBuilder('./img/stclogo.jpeg');
      const button = new ButtonBuilder()
        .setCustomId(`zoomRegister:${meeting.id}`)
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

      await targetMessage.edit({embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], files: [logo]})
    }
    await interaction.editReply('Itinerario actualizado')
  }catch (e) {
    console.error(e)
    await interaction.editReply(`**Error:** ${e.message}`)
  }
}
