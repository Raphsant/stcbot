import express from 'express';
import {Client, GatewayIntentBits} from 'discord.js';
import 'dotenv/config';

const app = express();
app.use(express.json());

// ---- ROUTES ----
app.post('/webhooks/cf-membership-cancelled', async (req, res) => {
  try{
    //WE GET THE USER ID FROM CF WEBHOOK
    const userId = req.body.data.attributes.id;
    //WE FETCH THE USER USING THE ID FROM CF
    const userData = await getUserById(userId);
    const fullName = `${userData.first_name} ${userData.last_name}`
    const email = userData.email;
    //WE CHECK THE ORDERS
    const userOrders = await getUserOrders(userId);
    //WE CHECK IF THE ORDER IS ACTIVE OR NOT
    const isThereAnActiveOrder = userOrders.some(order => order.service_status === "active")
    //IF THERE IS AN ORDER WE DO NOTHING TO THE USER
    if (isThereAnActiveOrder) return res.sendStatus(200);
    // IF THERE IS NO ACTIVE ORDER WE KICK THE USER
    else await kick(userData?.custom_attributes.discord_id, "Membresia cancelada");
    console.log(`El usuario ${fullName} (${email}) ha sido eliminado del servidor`);
    res.sendStatus(200);
  }catch(err){
    console.log('Error en el webhook de CF de membership cancelled');
    res.sendStatus(500);
  }
});

app.post('/webhooks/discord-enroll', async (req, res) => {
  try{
    //WE GET THE USER ID FROM CF WEBHOOK
    console.log(req.body.data);
    const userId = req.body.data.attributes.id;
    //WE FETCH THE USER USING THE ID FROM CF
    const userData = await getUserById(userId);
    const fullName = `${userData.first_name} ${userData.last_name}`
    const email = userData.email;
    //WE CHECK THE ORDERS
    const userOrders = await getUserOrders(userId);
    //WE CHECK IF THE ORDER IS ACTIVE OR NOT
    const isThereAnActiveOrder = userOrders.some(order => order.service_status === "active")
    if (isThereAnActiveOrder) {
      //IF THERE IS AN ORDER WE UPDATE THE USER ATTRIBUTES
      const discordId = await getDiscordIdByUsername(userData.custom_attributes.userdiscord);
      if(discordId === null) throw new Error('El usuario no tiene discord id o no fue encontrado')
      await updateUserAttributes(userId,discordId);
      //AND WE GIVE THE ROLE TO THE USER
      await giveRole(discordId, process.env.ROLE_ID);
      console.log(`El usuario ${fullName} (${email}) ha sido añadido en el servidor`);
      res.sendStatus(200);
    } else{
      console.log('no hay orden activa');
      res.sendStatus(200);
    }
  }catch (err){
    console.log('Error en el webhook de CF de enroll');
    res.sendStatus(500);
  }
})

//----END OF ROUTES----

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // needed to fetch & kick members
  ],
});

// Promise that resolves when the bot is logged in
const clientReady = new Promise((resolve) => {
  client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    resolve();
  });
});

// console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN);
client.login(process.env.DISCORD_BOT_TOKEN);


// ---- EXPRESS SERVER ----
app.listen(3000, () => console.log('Server running on port 3000'));

//https://eduardobricenosteam309bd.myclickfunnels.com/account/workspaces/JEMRor


//--------CF FUNCTIONS----------

async function getUserById(id) {
  const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/contacts/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.CF2_TOKEN}`,
      'accept': 'application/json'
    }
  })
  // console.log(await res.json());
  if(!res.ok) throw new Error(`Failed to fetch user with ID ${id}`)
  return res.json()
}


async function getUserOrders(id) {
  const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/workspaces/${process.env.WORKSPACE_ID}/orders?filter[contact_id]=${id}&filter[service_status]=active`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.CF2_TOKEN}`,
      'accept': 'application/json'
    }
  })
  if(!res.ok) throw new Error(`Failed to fetch orders for user with ID ${id}`)
  return res.json()
}

async function updateUserAttributes(id, discord_id) {
  try {
    const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/contacts/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.CF2_TOKEN}`,
        'accept': 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({contact: {custom_attributes: {discord_id: discord_id}}})


    })
    console.log(res);
  } catch (err) {
    console.log(err.message);
  }
}

//----END OF CF FUNCTIONS-----

//--------DISCORD SERVER FUNCTIONS----------

/**
 * Kicks a member from the Discord server by their user ID.
 * @param {string} id - The Discord user ID to kick.
 * @param {string} [reason] - Optional reason for the kick.
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise.
 */
async function kick(id, reason = 'No reason provided') {
  try {
    if (!id) throw new Error('El Usuario no tiene ID en ClickFunnels');
    await clientReady; // Ensure the bot is ready

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(id);

    await member.kick(reason);
    console.log(`✅ Successfully kicked user ${member.user.tag} (${id})`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to kick user ${id}:`, err.message);
    return false;
  }
}

/**
 * Gets a Discord user ID by their username.
 * @param {string} username - The Discord username to search for.
 * @returns {Promise<string|null>} - Returns the user ID if found, null otherwise.
 */
async function getDiscordIdByUsername(username) {
  try {
    // 1. Standard check if client is ready
    if (!client.isReady()) {
      console.error("❌ Client is not ready yet.");
      return null;
    }

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    // 2. Fetch using query (Requires GUILD_MEMBERS intent)
    // "limit: 1" is usually not enough because of partial matches, so 10 is good.
    const members = await guild.members.fetch({ query: username, limit: 10 });

    // 3. Find exact match
    // Note: This searches the unique username (e.g. "john_doe"), NOT the Display Name.
    const member = members.find(
      (m) => m.user.username.toLowerCase() === username.toLowerCase()
    );

    if (!member) {
      console.log(`❌ No user found with username: ${username}`);
      return null;
    }

    // .tag is deprecated, just use .username
    console.log(`✅ Found user ${member.user.username} with ID: ${member.id}`);
    return member.id;

  } catch (err) {
    console.error(`❌ Failed to find user by username ${username}:`, err.message);
    return null;
  }
}

/**
 * Gives a role to a user.
 * @param {string} userId - The Discord user ID.
 * @param {string} roleId - The role ID to assign.
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise.
 */
async function giveRole(userId, roleId) {
  try {
    await clientReady; // Ensure the bot is ready

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(userId);

    await member.roles.add(roleId);
    console.log(`✅ Successfully gave role ${roleId} to user ${member.user.tag} (${userId})`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to give role ${roleId} to user ${userId}:`, err.message);
    return false;
  }
}



