import { Client, GatewayIntentBits } from 'discord.js';
import { constantsConfig, closeMongooseConnection, registerEvents, Logger } from './lib';
import Events from './events/index';

if (!process.env.BOT_SECRET) {
  Logger.error('Missing BOT_SECRET environment variable. Exiting...');
  process.exit(1);
}

if (!constantsConfig.guildId) {
  Logger.error('Missing guildId configuration constant. Exiting...');
  process.exit(1);
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildPresences,
  ],
});

registerEvents(client, Events);

client.login(process.env.BOT_SECRET).catch((e) => {
  Logger.error(e);
  process.exit(1);
});

const handleTermination = async () => {
  Logger.info('Terminating bot...');
  try {
    client.removeAllListeners();
    await closeMongooseConnection();
    await client.destroy();
    Logger.info('Cleanup complete. Exiting...');
    process.exit(0);
  } catch (error) {
    Logger.error('Error during termination:', error);
    process.exit(1);
  }
};

// FIXME: this entire behavior seems to be not working as expected. "Cleanup complete. Exiting..." is not logged to the console. The process seems to exit prematurely.
// This is probably caused by the process not waiting for the promises but it requires a deeper investigation.
/* eslint-disable @typescript-eslint/no-misused-promises */
process.on('SIGINT', handleTermination);
process.on('SIGTERM', handleTermination);
/* eslint-enable @typescript-eslint/no-misused-promises */
