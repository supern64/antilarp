import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { Constants } from './constants';
import { config } from './config';
import { cleanupExpiredStates, createPendingState, deleteVerifiedUser, getVerifiedUser, type VerifiedUser } from './db';
import { generateState, buildAuthUrl } from './oauth';
import { createServer } from './server';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Mahidol Mail account to verify your student status')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unverify')
    .setDescription("Remove all verification data")
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
    : Routes.applicationCommands(config.discord.clientId);
  await rest.put(route, { body: commands });
}

function getRoles(facultyCode: string, enrollmentYear: string): string[] {
  const roles: string[] = []
  
  switch (facultyCode) {
    case "88":
      roles.push(Constants.roles.VERIFIED_ICT);
      break;
    case "87":
      roles.push(Constants.roles.VERIFIED_DST);
      break;
    default:
      roles.push(Constants.roles.VERIFIED_OTHER);
      break;
  }

  switch (enrollmentYear) {
    case "69":
      roles.push(Constants.roles.FRESHMAN);
      break;
    case "68":
      roles.push(Constants.roles.SOPHOMORE);
      break;
    case "67":
      roles.push(Constants.roles.JUNIOR);
      break;
    case "66":
      roles.push(Constants.roles.SENIOR);
      break;
  }
  return roles;
}

async function onVerified(user: VerifiedUser) {
  console.log(`[verify] discord=${user.discord_user_id} year=${user.enrollment_year} faculty=${user.faculty_code}`);

  const guild = client.guilds.cache.get(Constants.server.MYTH_OS);
  if (!guild) return;

  const member = await guild.members.fetch(user.discord_user_id).catch(() => null);
  if (!member) return;
 
  const rolesToAdd = getRoles(user.faculty_code, user.enrollment_year);
  try {
    if (rolesToAdd.length !== 0) await member.roles.add(rolesToAdd);
  } catch (err) {
    console.error("[verify] failed to add roles")
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  cleanupExpiredStates();
  const existing = getVerifiedUser(interaction.user.id);

  switch (interaction.commandName) {
    case "verify":
      if (existing) {
        await interaction.reply({
          content: `You're already verified. Run /unverify if you'd like to change your account.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const state = generateState();
      createPendingState(state, interaction.user.id, config.state.ttlMinutes);
      const url = buildAuthUrl(state);

      const button = new ButtonBuilder()
        .setEmoji("🔐")
        .setLabel("Sign In With Mahidol Mail")
        .setURL(url)
        .setStyle(ButtonStyle.Link);
      
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
      
      await interaction.reply({
        content: `# Sign in to verify\nThis button expires in ${config.state.ttlMinutes} minutes and is tied to your Discord account - don't share it with anyone else.\n\n-# By logging in, you verify your student status, faculty, and enrollment year. We do *not* see your password, nor any other information (e.g. mail, files) from your account. Your Discord ID, Microsoft account ID, time of verification and derived faculty/year will be stored indefinitely and used for role assignment as well as future verification. Your data will not be shared with any third party nor used for any other purpose. You may unverify with \`/unverify\` which removes all data, or send requests regarding this data to SuperN64#3700.`,
        flags: MessageFlags.Ephemeral,
        components: [row]
      });
      break;
    case "unverify":
      if (!existing) {
        await interaction.reply({
          content: `You are not verified.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      deleteVerifiedUser(interaction.user.id);

      // remove roles here
      const guild = client.guilds.cache.get(Constants.server.MYTH_OS);
      if (!guild) return;
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      try {
        await member.roles.remove(getRoles(existing.faculty_code, existing.enrollment_year));
      } catch (err) {
        console.error("[verify] failed to remove roles")
      }
      

      await interaction.reply({
        content: `You have been unverified. Please run /verify to verify again.`,
        flags: MessageFlags.Ephemeral
      });
      break;
  }
  
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user!.tag}`);
  client.user!.setActivity("/verify to verify");
});

async function main() {
  await registerCommands();

  const app = createServer(onVerified);
  app.listen(config.server.port, () => {
    console.log(`Callback server listening on port ${config.server.port}`);
  });

  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
