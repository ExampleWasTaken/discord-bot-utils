import { ChatInputCommandInteraction, Colors, User } from 'discord.js';
import { constantsConfig, getConn, PrefixCommandVersion, Logger, makeEmbed, refreshSinglePrefixCommandVersionCache, PrefixCommand } from '../../../../lib';

const noConnEmbed = makeEmbed({
    title: 'Prefix Commands - Modify Version - No Connection',
    description: 'Could not connect to the database. Unable to modify the prefix command version.',
    color: Colors.Red,
});

const failedEmbed = (versionId: string) => makeEmbed({
    title: 'Prefix Commands - Modify Version - Failed',
    description: `Failed to modify the prefix command version with id ${versionId}.`,
    color: Colors.Red,
});

const wrongFormatEmbed = (invalidString: string) => makeEmbed({
    title: 'Prefix Commands - Modify Version - Wrong format',
    description: `The name and alias of a version can only contain alphanumerical characters, underscores and dashes. "${invalidString}" is invalid.`,
    color: Colors.Red,
});

const doesNotExistsEmbed = (version: string) => makeEmbed({
    title: 'Prefix Commands - Modify Version - Does not exist',
    description: `The prefix command version ${version} does not exists. Cannot modify it.`,
    color: Colors.Red,
});

const alreadyExistsEmbed = (version: string, reason: string) => makeEmbed({
    title: 'Prefix Commands - Add Version - Already exists',
    description: `The prefix command version ${version} already exists: ${reason}`,
    color: Colors.Red,
});

const successEmbed = (version: string, versionId: string) => makeEmbed({
    title: `Prefix command version ${version} (${versionId}) was modified successfully.`,
    color: Colors.Green,
});

const modLogEmbed = (moderator: User, version: string, emoji: string, alias: string, enabled: boolean, versionId: string) => makeEmbed({
    title: 'Prefix command version modified',
    fields: [
        {
            name: 'Version',
            value: version,
        },
        {
            name: 'Moderator',
            value: `${moderator}`,
        },
        {
            name: 'Emoji',
            value: emoji,
        },
        {
            name: 'Alias',
            value: alias,
        },
        {
            name: 'Enabled',
            value: enabled ? 'Yes' : 'No',
        },
    ],
    footer: { text: `Version ID: ${versionId}` },
    color: Colors.Green,
});

const noModLogs = makeEmbed({
    title: 'Prefix Commands - Modified Version - No Mod Log',
    description: 'I can\'t find the mod logs channel. Please check the channel still exists.',
    color: Colors.Red,
});

export async function handleModifyPrefixCommandVersion(interaction: ChatInputCommandInteraction<'cached'>) {
    await interaction.deferReply({ ephemeral: true });

    const conn = getConn();
    if (!conn) {
        await interaction.followUp({ embeds: [noConnEmbed], ephemeral: true });
        return;
    }

    const version = interaction.options.getString('version')!;
    const name = interaction.options.getString('name') || '';
    const emoji = interaction.options.getString('emoji') || '';
    const alias = interaction.options.getString('alias')?.toLowerCase() || '';
    const enabled = interaction.options.getBoolean('is_enabled');
    const moderator = interaction.user;

    const nameRegex = /^[\w-]+$/;
    if (name && !nameRegex.test(name)) {
        await interaction.followUp({ embeds: [wrongFormatEmbed(name)], ephemeral: true });
        return;
    }
    if (alias && !nameRegex.test(alias)) {
        await interaction.followUp({ embeds: [wrongFormatEmbed(alias)], ephemeral: true });
        return;
    }
    if (name) {
        const foundVersion = await PrefixCommandVersion.findOne({
            name: {
                $ne: version,
                $eq: name,
            },
        });
        if (foundVersion || name.toLowerCase() === 'generic') {
            await interaction.followUp({ embeds: [alreadyExistsEmbed(version, `${name} already exists as a version.`)], ephemeral: true });
            return;
        }
    }
    if (alias) {
        const foundVersion = await PrefixCommandVersion.findOne({
            name: { $ne: version },
            alias,
        });
        if (foundVersion || alias === 'generic') {
            await interaction.followUp({ embeds: [alreadyExistsEmbed(version, `${alias} already exists as a version alias.`)], ephemeral: true });
            return;
        }
        const foundCommandName = await PrefixCommand.findOne({
            $or: [
                { name: alias },
                { aliases: alias },
            ],
        });
        if (foundCommandName) {
            await interaction.followUp({ embeds: [alreadyExistsEmbed(version, `${alias} already exists as a command or command alias.`)], ephemeral: true });
            return;
        }
    }

    //Check if the mod logs channel exists
    let modLogsChannel = interaction.guild.channels.resolve(constantsConfig.channels.MOD_LOGS);
    if (!modLogsChannel || !modLogsChannel.isTextBased()) {
        modLogsChannel = null;
        await interaction.followUp({ embeds: [noModLogs], ephemeral: true });
    }

    const existingVersion = await PrefixCommandVersion.findOne({ name: version });

    if (existingVersion) {
        const { id: versionId } = existingVersion;
        const oldVersion = existingVersion.$clone();
        existingVersion.name = name || existingVersion.name;
        existingVersion.emoji = emoji || existingVersion.emoji;
        existingVersion.alias = alias || existingVersion.alias;
        existingVersion.enabled = enabled !== null ? enabled : existingVersion.enabled;
        try {
            await existingVersion.save();
            const { name, emoji, alias, enabled } = existingVersion;
            await refreshSinglePrefixCommandVersionCache(oldVersion, existingVersion);
            await interaction.followUp({ embeds: [successEmbed(name, versionId)], ephemeral: true });
            if (modLogsChannel) {
                try {
                    await modLogsChannel.send({ embeds: [modLogEmbed(moderator, name, emoji, alias, enabled || false, versionId)] });
                } catch (error) {
                    Logger.error(`Failed to post a message to the mod logs channel: ${error}`);
                }
            }
        } catch (error) {
            Logger.error(`Failed to modify a prefix command version with id ${versionId}: ${error}`);
            await interaction.followUp({ embeds: [failedEmbed(versionId)], ephemeral: true });
        }
    } else {
        await interaction.followUp({ embeds: [doesNotExistsEmbed(version)], ephemeral: true });
    }
}
