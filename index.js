import express from 'express';
import {Client, GatewayIntentBits} from 'discord.js';
import 'dotenv/config';

const app = express();
app.use(express.json());

// ---- CF WEBHOOK ----
app.post('/webhooks/cf-membership-cancelled', async (req, res) => {
  console.log(req.body);

  //WE GET THE USER ID FROM CF WEBHOOK
  const userId = req.body.data.attributes.id;

  //WE FETCH THE USER USING THE ID FROM CF
  const userData = await getUserById(userId);


  res.sendStatus(200);
});

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

console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN);
client.login(process.env.DISCORD_BOT_TOKEN);

// ---- TEST ROUTE ----
app.get('/test', async (req, res) => {
  try {
    // ensure the bot is ready before using client.guilds / channels
    await clientReady;

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    console.log(`✅ Fetched guild: ${guild.name}`);

    const channel = await client.channels.fetch('684442343168147529');

    if (!channel || !channel.isTextBased()) {
      console.error('Channel not found or not text-based');
      return res.status(400).send('Invalid channel');
    }

    await channel.send('ACTIVATING KICK');
    console.log('hello world');

    res.send('Hello World!');
  } catch (err) {
    console.error('Error in /test route:', err);
    res.status(500).send('Error, check server logs');
  }
});

// ---- EXPRESS SERVER ----
app.listen(3000, () => console.log('Server running on port 3000'));

//https://eduardobricenosteam309bd.myclickfunnels.com/account/workspaces/JEMRor

async function getUserById(id) {
  const res = await fetch(`https://eduardobricenosteam309bd.myclickfunnels.com/api/v2/contacts/${id}}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.CF2_TOKEN}`,
      'accept': 'application/json'
    }
  })
  // console.log(await res.json());
  return res.json()
}

const test = async () => {
  const data = await getUserById('938642874')
  console.log(data.custom_attributes)
}

await test();

