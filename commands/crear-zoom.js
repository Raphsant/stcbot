import {
  SlashCommandBuilder, ButtonBuilder, ActionRowBuilder,
  EmbedBuilder, ButtonStyle, AttachmentBuilder
} from 'discord.js';

import {client as redis, getCachedZoomToken, getDailyJoins, saveMessageMap, getMessageMap} from "../redis-client.js";

export const data = new SlashCommandBuilder()
  .setName('crear-zoom')
  .setDescription('Crea un post sincronizado con Zoom usando el ID')
  .addStringOption(option =>
    option.setName('id_reunion').setDescription('ID de la reunión').setRequired(true));

export async function execute(interaction, helpers) {
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({content: 'No tienes permisos.', ephemeral: true});
  }

  await interaction.deferReply();

  try {
    const meetingId = interaction.options.getString('id_reunion').replace(/\s/g, '');
    const meeting = await helpers.getMeetingDetails(meetingId);

    // Discord Timestamp Formatting
    // <t:UNIX:F> = Full Date/Time (e.g. March 24, 2026 8:00 PM)
    // <t:UNIX:R> = Relative (e.g. "en 2 horas" or "hace 10 minutos")
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

    const message = await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(button)],
      files: [logo]
    });

    await saveMessageMap(message.id, meetingId, message.channelId);

  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ **Error:** ${err.message}`);
  }
}
