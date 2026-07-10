import {SlashCommandBuilder, EmbedBuilder, AttachmentBuilder} from 'discord.js';

// Solo las sesiones del grupo van en el calendario — nada de reuniones personales o 1-1.
// La comparación ignora mayúsculas y acentos ("Sesión de Progreso" ~ "sesion de progreso").
const KEYWORDS = ['zombie hour', 'q&a', 'sesion de progreso', 'analisis de premarket'];

export const data = new SlashCommandBuilder()
  .setName('calendario')
  .setDescription('ADMIN ONLY: Publica el calendario semanal de sesiones de Zoom.');

// Encabezado del día en horario Houston (solo para agrupar; cada sesión lleva su timestamp local)
function dayHeader(timestamp) {
  const label = new Date(timestamp * 1000).toLocaleDateString('es-MX', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Construye el payload del calendario ({embeds, files}) listo para enviar, ya sea
// como respuesta a /calendario o desde el cron semanal. Devuelve null si no hay
// sesiones en la ventana. Compartido para no duplicar el formato en dos lugares.
export async function buildCalendarMessage(getWeeklySessions) {
  const sessions = await getWeeklySessions(KEYWORDS, 7);
  if (sessions.length === 0) return null;

  // Agrupar por día (las sesiones ya vienen ordenadas por fecha)
  const days = new Map();
  for (const session of sessions) {
    const header = dayHeader(session.timestamp);
    if (!days.has(header)) days.set(header, []);
    days.get(header).push(session);
  }

  let description = '🕒 Los horarios se muestran automáticamente en **tu zona horaria local**.\n';
  for (const [header, daySessions] of days) {
    description += `\n**📆 ${header}**\n\n`;
    for (const s of daySessions) {
      description += `📹 **${s.topic}**\n⏰ <t:${s.timestamp}:F> · <t:${s.timestamp}:R>\n\n`;
    }
  }

  // Límite de descripción de embeds: 4096 caracteres
  if (description.length > 4096) {
    description = description.slice(0, 4090) + '\n…';
  }

  const logo = new AttachmentBuilder('./img/stclogo.jpeg');
  const embed = new EmbedBuilder()
    .setColor('#2D8CFF')
    .setTitle('📅 Calendario Semanal de Sesiones')
    .setDescription(description)
    .setThumbnail('attachment://stclogo.jpeg')
    .setFooter({text: 'Sincronizado automáticamente con Zoom API'});

  return {embeds: [embed], files: [logo]};
}

export async function execute(interaction, {getWeeklySessions}) {
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({content: 'No tienes permisos para usar este comando', ephemeral: true});
  }
  await interaction.deferReply();

  try {
    const payload = await buildCalendarMessage(getWeeklySessions);
    if (!payload) {
      return interaction.editReply('No se encontraron sesiones programadas para los próximos 7 días.');
    }
    await interaction.editReply(payload);
  } catch (e) {
    console.error(e);
    await interaction.editReply(`**Error:** ${e.message}`);
  }
}
