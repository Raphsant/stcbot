import {trackJoin} from "../redis-client.js";

export async function execute(interaction, helpers) {
  await interaction.deferReply({ephemeral: true});

  // Use the ID from metadata, or fallback to the .env default
  const [meetingIdFromMeta, timestamp] = (helpers.metadata || "").split(':');
  const meetingId = meetingIdFromMeta || process.env.ZOOM_MEETING_ID;

  try {
    const joinUrl = await helpers.createRegistrant(interaction.member.displayName, interaction.user.id, meetingId);
    const data = await helpers.getMeetingDetails(meetingId);
    const meeting = {
      meetingId: data.id,
      timestamp: data.timestamp,
      name: data.topic,
    }


    // // Log the join with the start time if available
    if (helpers.sendLogToDb) {
      await helpers.sendLogToDb(meeting, interaction.member, interaction.user);
    }

    // Record the join in Redis
    await trackJoin(interaction.member.displayName, meetingId);


    console.log(`${interaction.member.displayName},`)

    await interaction.editReply(`✅ Registro exitoso para la sesión!\nEnlace único para @${interaction.member.displayName}:\n ${joinUrl}`);
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ Error de Zoom: ${err.message}`);
  }
}
