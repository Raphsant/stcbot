import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export async function execute(interaction) {
  if (interaction.member.roles.cache.has(process.env.ROLE_ID)) {
    await interaction.deferReply({ephemeral: true});
    await interaction.editReply(`Ya estas registrado en el servidor.`)
    return
  }
  const modal = new ModalBuilder()
    .setCustomId('enrollmentModal')
    .setTitle('Verificación de membresía');

  const input = new TextInputBuilder()
    .setCustomId('emailInput')
    .setLabel('Correo electrónico')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('email@domain.com')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(input);
  modal.addComponents(row);

  await interaction.showModal(modal);
}
