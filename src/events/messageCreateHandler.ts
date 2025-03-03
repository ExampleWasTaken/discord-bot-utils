import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Interaction, Message, PermissionsBitField } from 'discord.js';
import { event, getInMemoryCache, MemoryCachePrefix, Logger, Events, constantsConfig, makeEmbed, makeLines, PrefixCommand, PrefixCommandPermissions, PrefixCommandVersion } from '../lib';

const commandEmbed = (title: string, description: string, color: string, imageUrl: string = '') => makeEmbed({
    title,
    description,
    color: Number(color),
    ...(imageUrl && { image: { url: imageUrl } }),
});

async function replyWithEmbed(msg: Message, embed: EmbedBuilder, buttonRow?: ActionRowBuilder<ButtonBuilder>) : Promise<Message<boolean>> {
    return msg.fetchReference()
        .then((res) => {
            embed = EmbedBuilder.from(embed.data);
            embed.setFooter({ text: `Executed by ${msg.author.tag} - ${msg.author.id}` });
            return res.reply({
                embeds: [embed],
                components: buttonRow ? [buttonRow] : [],
            });
        })
        .catch(() => msg.reply({
            embeds: [embed],
            components: buttonRow ? [buttonRow] : [],
        }));
}

async function replyWithMsg(msg: Message, text: string, buttonRow?:ActionRowBuilder<ButtonBuilder>) : Promise<Message<boolean>> {
    return msg.fetchReference()
        .then((res) => res.reply({
            content: `${text}\n\n\`Executed by ${msg.author.tag} - ${msg.author.id}\``,
            components: buttonRow ? [buttonRow] : [],
        }))
        .catch(() => msg.reply({
            content: text,
            components: buttonRow ? [buttonRow] : [],
        }));
}

async function sendReply(message: Message, commandTitle: string, commandContent: string, isEmbed: boolean, embedColor: string, commandImage: string, versionButtonRow?: ActionRowBuilder<ButtonBuilder>) : Promise<Message<boolean> | undefined> {
    try {
        let actualCommandContent = commandContent;
        if (!commandTitle && !commandContent && !commandImage) {
            actualCommandContent = 'No content available.';
        }
        if (isEmbed) {
            return replyWithEmbed(message, commandEmbed(commandTitle, actualCommandContent, embedColor, commandImage), versionButtonRow);
        }
        const content: string[] = [];
        if (commandTitle) {
            content.push(`**${commandTitle}**`);
        }
        content.push(actualCommandContent);
        return replyWithMsg(message, makeLines(content), versionButtonRow);
    } catch (error) {
        Logger.error(`Error processing the reply: ${error}`);
        return undefined;
    }
}

async function expireChoiceReply(message: Message, commandTitle: string, commandContent: string, isEmbed: boolean, embedColor: string, commandImage: string) : Promise<Message<boolean> | undefined> {
    try {
        let actualCommandContent = commandContent;
        if (!commandTitle && !commandContent && !commandImage) {
            actualCommandContent = 'No content available.';
        }
        if (isEmbed) {
            const commandEmbedData = commandEmbed(commandTitle, actualCommandContent, embedColor, commandImage);
            const { footer } = message.embeds[0];
            const newFooter = footer?.text ? `${footer.text} - The choice has expired.` : 'The choice has expired.';
            commandEmbedData.setFooter({ text: newFooter });
            return message.edit({ embeds: [commandEmbedData], components: [] });
        }

        const content: string[] = [];
        if (commandTitle) {
            content.push(`**${commandTitle}**`);
        }
        content.push(actualCommandContent);
        content.push('\n`The choice has expired.`');
        return message.edit({
            content: makeLines(content),
            components: [],
        });
    } catch (error) {
        Logger.error(`Error processing the expiration reply: ${error}`);
        return undefined;
    }
}

async function sendPermError(message: Message, errorText: string) {
    if (constantsConfig.prefixCommandPermissionDelay > 0) {
        errorText += `\n\nThis message & the original command message will be deleted in ${constantsConfig.prefixCommandPermissionDelay / 1000} seconds.`;
    }
    const permReply = await sendReply(message, 'Permission Error', errorText, true, constantsConfig.colors.FBW_RED, '');
    if (!permReply) return;
    if (constantsConfig.prefixCommandPermissionDelay > 0) {
        setTimeout(() => {
            try {
                permReply.delete();
                message.delete();
            } catch (error) {
                Logger.error(`Error while deleting permission error message for command: ${error}`);
            }
        }, constantsConfig.prefixCommandPermissionDelay);
    }
}

export default event(Events.MessageCreate, async (_, message) => {
    const { id: messageId, author, channel, content, guild } = message;
    const { id: authorId, bot } = author;

    if (bot || !guild || channel.isDMBased() || !channel.isTextBased()) return;
    const thisBot = guild.members.me;
    if (!thisBot) return;
    const { id: channelId, name: channelName } = channel;
    const { id: guildId } = guild;
    Logger.debug(`Processing message ${messageId} from user ${authorId} in channel ${channelId} of server ${guildId}.`);

    const inMemoryCache = getInMemoryCache();
    if (inMemoryCache && content.startsWith(constantsConfig.prefixCommandPrefix)) {
        const commandTextMatch = content.match(`^\\${constantsConfig.prefixCommandPrefix}([\\w\\d-_]+)[^\\w\\d-_]*([\\w\\d-_]+)?`);
        if (commandTextMatch) {
            let [commandText] = commandTextMatch.slice(1);
            const commandVersionExplicitGeneric = (commandText.toLowerCase() === 'generic');

            // Step 1: Check if the command is actually a version alias
            const commandCachedVersion = await inMemoryCache.get(`${MemoryCachePrefix.VERSION}:${commandText.toLowerCase()}`);
            let commandVersionId: string;
            let commandVersionName: string;
            let commandVersionEnabled: boolean;
            if (commandCachedVersion) {
                const commandVersion = PrefixCommandVersion.hydrate(commandCachedVersion);
                ({ id: commandVersionId, name: commandVersionName, enabled: commandVersionEnabled } = commandVersion);
            } else {
                commandVersionId = 'GENERIC';
                commandVersionName = 'GENERIC';
                commandVersionEnabled = true;
            }

            // Step 2: Check if there's a default version for the channel if commandVersionName is GENERIC
            let channelDefaultVersionUsed = false;
            if (commandVersionName === 'GENERIC' && !commandVersionExplicitGeneric) {
                const channelDefaultVersionCached = await inMemoryCache.get(`${MemoryCachePrefix.CHANNEL_DEFAULT_VERSION}:${channelId}`);
                if (channelDefaultVersionCached) {
                    const channelDefaultVersion = PrefixCommandVersion.hydrate(channelDefaultVersionCached);
                    ({ id: commandVersionId, name: commandVersionName, enabled: commandVersionEnabled } = channelDefaultVersion);
                    channelDefaultVersionUsed = true;
                }
            }

            // Drop execution if the version is disabled and we aren't using the default version for a channel
            if (!commandVersionEnabled && !channelDefaultVersionUsed) {
                if ((commandCachedVersion || commandVersionExplicitGeneric) && commandTextMatch[2]) {
                    [commandText] = commandTextMatch.slice(2);
                }
                Logger.debug(`Prefix Command - Version "${commandVersionName}" is disabled - Not executing command "${commandText}"`);
                return;
            }
            // If the version is disabled and we are using the default version for a channel, switch to the generic version
            if (!commandVersionEnabled && channelDefaultVersionUsed) {
                commandVersionId = 'GENERIC';
                commandVersionName = 'GENERIC';
                commandVersionEnabled = true;
            }

            // Step 2.5: If the first command was actually a version alias, take the actual command as CommandText
            if ((commandCachedVersion || commandVersionExplicitGeneric) && commandTextMatch[2]) {
                [commandText] = commandTextMatch.slice(2);
            }

            // Step 3: Check if the command exists itself and process it
            const cachedCommandDetails = await inMemoryCache.get(`${MemoryCachePrefix.COMMAND}:${commandText.toLowerCase()}`);
            if (cachedCommandDetails) {
                // Checking if the bos has proper permissions
                const botPermissions = channel.permissionsFor(thisBot);
                const requiredBotPermissions = [
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                ];
                // No point in continuing if the bot can't post a message or reply to a message
                if (!botPermissions || !botPermissions.has(requiredBotPermissions)) {
                    Logger.info(`Bot does not have required permissions in channel ${channelName} (${channelId}) of server ${guildId}. Unable to process message ${messageId} from user ${authorId}.`);
                    return;
                }
                const commandDetails = PrefixCommand.hydrate(cachedCommandDetails);
                const { name, contents, isEmbed, embedColor, permissions } = commandDetails;
                const { roles: permRoles, rolesBlocklist, channels: permChannels, channelsBlocklist, quietErrors, verboseErrors } = permissions ?? new PrefixCommandPermissions();
                const authorMember = await guild.members.fetch(authorId);

                // Check permissions
                const hasAnyRole = permRoles && permRoles.some((role) => authorMember.roles.cache.has(role));
                const isInChannel = permChannels && permChannels.includes(channelId);
                const meetsRoleRequirements = !permRoles || permRoles.length === 0
                    || (hasAnyRole && !rolesBlocklist)
                    || (!hasAnyRole && rolesBlocklist);
                const meetsChannelRequirements = !permChannels || permChannels.length === 0
                    || (isInChannel && !channelsBlocklist)
                    || (!isInChannel && channelsBlocklist);

                if (!meetsRoleRequirements) {
                    Logger.debug(`Prefix Command - User does not meet role requirements for command "${name}" based on user command "${commandText}"`);
                    if (quietErrors) return;
                    let errorText = '';
                    if (verboseErrors && !rolesBlocklist) {
                        errorText = `You do not have the required role to execute this command. Required roles: ${permRoles.map((role) => guild.roles.cache.get(role)?.name).join(', ')}.`;
                    } else if (verboseErrors && rolesBlocklist) {
                        errorText = `You have a blocklisted role for this command. Blocklisted roles: ${permRoles.map((role) => guild.roles.cache.get(role)?.name).join(', ')}.`;
                    } else if (!verboseErrors && !rolesBlocklist) {
                        errorText = 'You do not have the required role to execute this command.';
                    } else {
                        errorText = 'You have a blocklisted role for this command.';
                    }
                    await sendPermError(message, errorText);
                    return;
                }

                if (!meetsChannelRequirements) {
                    Logger.debug(`Prefix Command - Message does not meet channel requirements for command "${name}" based on user command "${commandText}"`);
                    if (quietErrors) return;
                    let errorText = '';
                    if (verboseErrors && !channelsBlocklist) {
                        errorText = `This command is not available in this channel. Required channels: ${permChannels.map((channel) => guild.channels.cache.get(channel)?.toString()).join(', ')}.`;
                    } else if (verboseErrors && channelsBlocklist) {
                        errorText = `This command is blocklisted in this channel. Blocklisted channels: ${permChannels.map((channel) => guild.channels.cache.get(channel)?.toString()).join(', ')}.`;
                    } else if (!verboseErrors && !channelsBlocklist) {
                        errorText = 'This command is not available in this channel.';
                    } else {
                        errorText = 'This command is blocklisted in this channel.';
                    }
                    await sendPermError(message, errorText);
                    return;
                }

                let commandContentData = contents.find(({ versionId }) => versionId === commandVersionId);
                let enableButtons = true;
                // If the version is not found, try to find the generic version
                if (!commandContentData) {
                    commandContentData = contents.find(({ versionId }) => versionId === 'GENERIC');
                    commandVersionName = 'GENERIC';
                    enableButtons = false;
                }
                // If the generic version is not found, drop execution
                if (!commandContentData) {
                    Logger.debug(`Prefix Command - Version "${commandVersionName}" not found for command "${name}" based on user command "${commandText}"`);
                    return;
                }
                Logger.info(`Prefix Command - Executing command "${name}" and version "${commandVersionName}" based on user command "${commandText}" in channel ${channelName}.`);
                const { title: commandTitle, content: commandContent, image: commandImage } = commandContentData;
                // If generic requested and multiple versions, show the selection
                // Note that this only applies if GENERIC is the version explicitly requested
                // Otherwise, the options are not shown
                if (enableButtons && commandVersionName === 'GENERIC' && contents.length > 1) {
                    Logger.debug(`Prefix Command - Multiple versions found for command "${name}" based on user command "${commandText}", showing version selection`);
                    const versionSelectionButtonData: { [key: string]: ButtonBuilder } = {};
                    for (const { versionId: versionIdForButton } of contents) {
                        // eslint-disable-next-line no-await-in-loop
                        const versionCached = await inMemoryCache.get(`${MemoryCachePrefix.VERSION}:${versionIdForButton}`);
                        if (versionCached) {
                            const version = PrefixCommandVersion.hydrate(versionCached);
                            const { emoji, enabled } = version;
                            if (enabled) {
                                versionSelectionButtonData[emoji] = new ButtonBuilder()
                                    .setCustomId(`${versionIdForButton}`)
                                    .setEmoji(emoji)
                                    .setStyle(ButtonStyle.Primary);
                            }
                        }
                    }
                    const versionSelectionButtons: ButtonBuilder[] = Object.keys(versionSelectionButtonData)
                        .sort()
                        .map((key: string) => versionSelectionButtonData[key]);
                    const versionSelectButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(versionSelectionButtons);

                    if (versionSelectButtonRow.components.length < 1) {
                        Logger.debug(`Prefix Command - No enabled versions found for command "${name}" based on user command "${commandText}"`);
                        Logger.debug(`Prefix Command - Executing version "${commandVersionName}" for command "${name}" based on user command "${commandText}"`);
                        await sendReply(message, commandTitle, commandContent || '', isEmbed || false, embedColor || constantsConfig.colors.FBW_CYAN, commandImage || '');
                        return;
                    }
                    const buttonMessage = await sendReply(message, commandTitle, commandContent || '', isEmbed || false, embedColor || constantsConfig.colors.FBW_CYAN, commandImage || '', versionSelectButtonRow);
                    if (!buttonMessage) return;

                    const filter = (interaction: Interaction) => interaction.user.id === authorId;
                    const collector = buttonMessage.createMessageComponentCollector({ filter, time: 60_000 });
                    let buttonClicked = false;
                    collector.on('collect', async (collectedInteraction: ButtonInteraction) => {
                        buttonClicked = true;
                        await collectedInteraction.deferUpdate();
                        Logger.debug(`Prefix Command - User selected button "${collectedInteraction.customId}" for command "${name}" based on user command "${commandText}"`);
                        try {
                            await buttonMessage.delete();
                        } catch (error) {
                            Logger.error(`Failed to delete the version selection message: ${error}`);
                        }
                        const { customId: selectedVersionId } = collectedInteraction;
                        const commandContentData = contents.find(({ versionId }) => versionId === selectedVersionId);
                        if (!commandContentData) {
                            Logger.debug(`Prefix Command - Version ID "${selectedVersionId}" not found for command "${name}" based on user command "${commandText}"`);
                            return;
                        }
                        const { title: commandTitle, content: commandContent, image: commandImage } = commandContentData;
                        await sendReply(message, commandTitle, commandContent || '', isEmbed || false, embedColor || constantsConfig.colors.FBW_CYAN, commandImage || '');
                    });

                    collector.on('end', async (_: ButtonInteraction, reason: string) => {
                        if (!buttonClicked && reason === 'time') {
                            Logger.debug(`Prefix Command - User did not select a version for command "${name}" based on user command "${commandText}"`);
                            await expireChoiceReply(buttonMessage, commandTitle, commandContent || '', isEmbed || false, embedColor || constantsConfig.colors.FBW_CYAN, commandImage || '');
                        }
                    });
                } else {
                    await sendReply(message, commandTitle, commandContent || '', isEmbed || false, embedColor || constantsConfig.colors.FBW_CYAN, commandImage || '');
                }
            }
        }
    }
});
