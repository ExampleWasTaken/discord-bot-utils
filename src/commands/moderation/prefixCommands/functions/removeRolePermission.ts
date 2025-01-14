import { ChatInputCommandInteraction, Colors, User } from 'discord.js';
import { constantsConfig, getConn, PrefixCommand, Logger, makeEmbed, refreshSinglePrefixCommandCache } from '../../../../lib';

const noConnEmbed = makeEmbed({
    title: 'Prefix Commands - Remove Role - No Connection',
    description: 'Could not connect to the database. Unable to remove the prefix command role.',
    color: Colors.Red,
});

const noCommandEmbed = (command: string) => makeEmbed({
    title: 'Prefix Commands - Remove Role - No Command',
    description: `Failed to remove the prefix command role for command ${command} as the command does not exist or there are more than one matching.`,
    color: Colors.Red,
});

const failedEmbed = (command: string, roleName: string) => makeEmbed({
    title: 'Prefix Commands - Remove Role - Failed',
    description: `Failed to remove the prefix command role ${roleName} for command ${command}.`,
    color: Colors.Red,
});

const doesNotExistEmbed = (command: string, roleName: string) => makeEmbed({
    title: 'Prefix Commands - Remove Role - Already exists',
    description: `A prefix command role ${roleName} for command ${command} and role does not exist.`,
    color: Colors.Red,
});

const successEmbed = (command: string, roleName: string) => makeEmbed({
    title: `Prefix command role ${roleName} removed for command ${command}.`,
    color: Colors.Green,
});

const modLogEmbed = (moderator: User, command: string, roleName: string) => makeEmbed({
    title: 'Remove prefix command role permission',
    fields: [
        {
            name: 'Command',
            value: command,
        },
        {
            name: 'Role',
            value: roleName,
        },
        {
            name: 'Moderator',
            value: `${moderator}`,
        },
    ],
    color: Colors.Green,
});

const noModLogs = makeEmbed({
    title: 'Prefix Commands - Remove Role - No Mod Log',
    description: 'I can\'t find the mod logs role. Please check the role still exists.',
    color: Colors.Red,
});

export async function handleRemovePrefixCommandRolePermission(interaction: ChatInputCommandInteraction<'cached'>) {
    await interaction.deferReply({ ephemeral: true });

    const conn = getConn();
    if (!conn) {
        await interaction.followUp({ embeds: [noConnEmbed], ephemeral: true });
        return;
    }

    const command = interaction.options.getString('command')!;
    const role = interaction.options.getRole('role')!;
    const moderator = interaction.user;

    //Check if the mod logs role exists
    let modLogsChannel = interaction.guild.channels.resolve(constantsConfig.channels.MOD_LOGS);
    if (!modLogsChannel || !modLogsChannel.isTextBased()) {
        modLogsChannel = null;
        await interaction.followUp({ embeds: [noModLogs], ephemeral: true });
    }

    let foundCommands = await PrefixCommand.find({ name: command });
    if (!foundCommands || foundCommands.length > 1) {
        foundCommands = await PrefixCommand.find({ aliases: { $in: [command] } });
    }
    if (!foundCommands || foundCommands.length > 1) {
        await interaction.followUp({ embeds: [noCommandEmbed(command)], ephemeral: true });
        return;
    }
    const [foundCommand] = foundCommands;
    const { id: roleId, name: roleName } = role;

    const existingRolePermission = foundCommand.permissions.roles?.includes(roleId);
    if (existingRolePermission) {
        foundCommand.permissions.roles = foundCommand.permissions.roles?.filter((id) => id !== roleId);
        try {
            await foundCommand.save();
            await refreshSinglePrefixCommandCache(foundCommand, foundCommand);
            await interaction.followUp({ embeds: [successEmbed(command, roleName)], ephemeral: true });
            if (modLogsChannel) {
                try {
                    await modLogsChannel.send({ embeds: [modLogEmbed(moderator, command, roleName)] });
                } catch (error) {
                    Logger.error(`Failed to post a message to the mod logs role: ${error}`);
                }
            }
        } catch (error) {
            Logger.error(`Failed to remove prefix command role ${roleName} for command ${command}: ${error}`);
            await interaction.followUp({ embeds: [failedEmbed(command, roleName)], ephemeral: true });
        }
    } else {
        await interaction.followUp({ embeds: [doesNotExistEmbed(command, roleName)], ephemeral: true });
    }
}
