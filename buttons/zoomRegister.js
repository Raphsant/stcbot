import {trackJoin} from "../redis-client.js";
import {time} from "discord.js";

export async function execute(interaction, helpers) {
  await interaction.deferReply({ephemeral: true});

  // Use the ID from metadata, or fallback to the .env default
  const [meetingIdFromMeta, timestamp] = (helpers.metadata || "").split(':');
  const meetingId = meetingIdFromMeta || process.env.ZOOM_MEETING_ID;

  try {
    const data = await helpers.getMeetingDetails(meetingId);

    const now = Math.floor(Date.now() / 1000);
    const twoHoursInSeconds = 2 * 60 * 60;
    // if (timestamp - now > twoHoursInSeconds) {
    //   return interaction.editReply('⏳ La reunión no comenzará pronto. Por favor, regresa más tarde cuando la sesión esté a punto de iniciar.');
    // }

    const joinUrl = await helpers.createRegistrant(interaction.member.displayName, interaction.user.id, meetingId);

    // Use the timestamp from the button metadata for logging so that late users
    // are recorded against the occurrence they actually attended, not the next one.
    const logTimestamp = timestamp ? parseInt(timestamp, 10) : data.timestamp;
    const meeting = {
      meetingId: data.id,
      timestamp: logTimestamp,
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
