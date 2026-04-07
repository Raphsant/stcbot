import {
  SlashCommandBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonStyle
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setup-enroll')
  .setDescription('ADMIN ONLY: Posts the enrollment button in this channel');

export async function execute(interaction) {
  // Check permissions
  if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
    return interaction.reply({
      content: 'No tienes permisos para usar este comando',
      ephemeral: true
    });
  }

  const button = new ButtonBuilder()
    .setCustomId('openEnrollModal')
    .setLabel('Ingresar al Grupo Delta')
    .setStyle(ButtonStyle.Primary)
    .setEmoji("📈");

  const row = new ActionRowBuilder().addComponents(button);

  const embed = new EmbedBuilder()
    .setColor('#ea9d13')
    .setTitle('Ingresa al Grupo Delta')
    .setDescription(`Bienvenido a Stocks Trading Club.\nPara acceder al contenido exclusivo del Grupo Delta, necesitamos verificar tu subscripcion.\n\n**¿Como funciona?**\n1. Haz Click en el boton de abajo.\n2. Ingresa tu email que usaste para realizar el pago.`)
    .setFooter({ text: 'Sistema de verificacion de Stocks Trading Club' });

  await interaction.reply({ embeds: [embed], components: [row] });
}
