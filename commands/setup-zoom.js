import {SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, EmbedBuilder, ButtonStyle, AttachmentBuilder} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setup-zoom')
  .setDescription('ADMIN ONLY: Posts the Zoom registration button');

export async function execute(interaction, helpers) {
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({content: 'No tienes permisos para usar este comando', ephemeral: true});
  }
  try {
    const meetingId = process.env.ZOOM_MEETING_ID;
    const meeting = await helpers.getMeetingDetails(meetingId);
    const timeString = `<t:${meeting.timestamp}:F>\n🕒 **Inicia:** <t:${meeting.timestamp}:R>`;
    const logo = new AttachmentBuilder('./img/stclogo.jpeg');
    const button = new ButtonBuilder()
      .setCustomId('zoomRegister')
      .setLabel('Obtener link de acceso')
      .setStyle(ButtonStyle.Success)
      .setEmoji("📹");

    const row = new ActionRowBuilder().addComponents(button);
    const embed = new EmbedBuilder()
      .setColor('#2D8CFF')
      .setTitle('Sesión de Progreso')
      .setDescription(`Registro para Sesión de Zoom.\nHaz clic en el botón de abajo para obtener tu enlace único de acceso.`)
      .setThumbnail('attachment://stclogo.jpeg')
      .addFields(
        {name: '📅 Horario Local', value: timeString, inline: false},
      )
      .setFooter({text: 'Sistema de registro de Zoom - STC Bot'});

    await interaction.reply({embeds: [embed], components: [row], files: [logo]});
  } catch (e) {
    console.error(e)
  }


}
