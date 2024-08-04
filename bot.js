const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { format } = require('date-fns');
const { Client, GatewayIntentBits, MessageEmbed } = require('discord.js');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js')

// Funktion zum Laden der Konfiguration
const loadConfig = () => {
    try {
        return JSON.parse(fs.readFileSync('config.json', 'utf8'));
    } catch (error) {
        console.error('Error loading configuration:', error.message);
        return null;
    }
};

// Funktion zum Speichern der Konfiguration
const saveConfig = (config) => {
    try {
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving configuration:', error.message);
    }
};

// Lade die Konfiguration
let config = loadConfig();

// Erstelle den Discord-Client mit den richtigen Intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Event: Bot ist bereit
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready to handle commands.');
});

// Variable zum Speichern der laufenden Prozesse
const streamProcesses = {};
let statusInProgress = false; // Lock-Variable zur Vermeidung mehrfacher Status-Nachrichten

// Funktion zum Erstellen eines Embeds
const createEmbed = (title, description, color = '#0099ff') => {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
};

// Funktion zum Aufnehmen eines Streams
const recordStream = (channel) => {
    const channelPath = path.join(config.recordingsPath, channel);
    if (!fs.existsSync(channelPath)) {
        fs.mkdirSync(channelPath, { recursive: true });
    }

    const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm-ss');
    const filename = path.join(channelPath, `twitch-${timestamp}.mp4`);
    const streamlinkCommand = `streamlink "https://www.twitch.tv/${channel}" "best" --twitch-proxy-playlist "${config.twitchProxyPlaylist}" --retry-streams "30" --stdout`;

    console.log(`Start recording for channel: ${channel}`);

    // Starten Sie den Streamlink-Prozess und speichern Sie die Prozessreferenz
    const streamlinkProcess = spawn(streamlinkCommand, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Starten Sie den ffmpeg-Prozess und verbinden Sie ihn mit dem Streamlink-Prozess
    const ffmpegProcess = spawn('ffmpeg', ['-i', '-', '-c', 'copy', filename], {
        stdio: ['pipe', 'inherit', 'inherit'],
    });

    // Pipe stdout von Streamlink zu stdin von ffmpeg
    streamlinkProcess.stdout.pipe(ffmpegProcess.stdin);

    // Speichern beider Prozesse
    streamProcesses[channel] = {
        streamlinkProcess,
        ffmpegProcess
    };

    streamlinkProcess.on('exit', () => {
        console.log(`Recording stopped for channel: ${channel}`);
        delete streamProcesses[channel];
    });

    streamlinkProcess.on('error', (error) => {
        console.error(`Error recording stream ${channel}: ${error.message}`);
    });

    ffmpegProcess.on('error', (error) => {
        console.error(`Error processing stream ${channel}: ${error.message}`);
    });
};

// Funktion zum Stoppen eines Streams
const stopStream = (channel) => {
    if (streamProcesses[channel]) {
        console.log(`Stopping recording for channel: ${channel}`);

        // Beenden des ffmpeg-Prozesses
        if (streamProcesses[channel].ffmpegProcess) {
            try {
                streamProcesses[channel].ffmpegProcess.stdin.end(); // Beendet den Stream von ffmpeg
                streamProcesses[channel].ffmpegProcess.kill('SIGTERM');
                console.log(`ffmpeg process stopped for channel: ${channel}`);
            } catch (error) {
                console.error(`Error stopping ffmpeg process for channel ${channel}: ${error.message}`);
            }
        }

        // Beenden des Streamlink-Prozesses
        if (streamProcesses[channel].streamlinkProcess) {
            try {
                streamProcesses[channel].streamlinkProcess.kill('SIGTERM');
                console.log(`streamlink process stopped for channel: ${channel}`);
            } catch (error) {
                console.error(`Error stopping streamlink process for channel ${channel}: ${error.message}`);
            }
        }

        // Entfernen der Prozesse aus der globalen Variable
        delete streamProcesses[channel];
    } else {
        console.log(`No recording process found for channel: ${channel}`);
    }
};

// Funktion zum Überprüfen des Live-Status eines Streams
const checkStreamStatus = async (channel) => {
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
            headers: {
                'Client-ID': config.twitchClientId,
                'Authorization': `Bearer ${config.twitchAccessToken}`,
            },
        });

        const stream = response.data.data[0];
        return stream ? stream.type === 'live' : false;
    } catch (error) {
        console.error(`Error checking stream status for ${channel}: ${error.message}`);
        return false;
    }
};

// Funktion zum Holen von Streamer-Informationen
const getStreamerInfo = async (channel) => {
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/users?login=${channel}`, {
            headers: {
                'Client-ID': config.twitchClientId,
                'Authorization': `Bearer ${config.twitchAccessToken}`,
            },
        });

        return response.data.data[0] || {};
    } catch (error) {
        console.error(`Error fetching streamer info for ${channel}: ${error.message}`);
        return {};
    }
};

const sentMessages = new Set(); // Set zum Speichern bereits gesendeter Nachrichten

// Funktion zum Starten der Aufzeichnung basierend auf dem Live-Status
const handleStreamMonitoring = async (channel) => {
    const isLive = await checkStreamStatus(channel);

    // Nachricht zum Monitoring senden, nur wenn sie noch nicht gesendet wurde
    const discordChannelId = config.discordChannelId;
    const monitoringChannel = client.channels.cache.get(discordChannelId);

    if (monitoringChannel) {
        const message = `Monitoring executed for channel: ${channel}`;
        const embed = createEmbed('Stream Monitoring', message);

        if (!sentMessages.has(message)) {
            monitoringChannel.send({ embeds: [embed] });
            sentMessages.add(message);
        }
    } else {
        console.error(`Channel with ID ${discordChannelId} not found.`);
    }

    if (isLive) {
        if (!streamProcesses[channel]) {
            console.log(`Channel ${channel} is live. Starting recording.`);
            recordStream(channel);
        }
    } else {
        if (streamProcesses[channel]) {
            console.log(`Channel ${channel} is not live. Stopping recording.`);
            stopStream(channel);
        }
    }
};

// Überwacht die Streams regelmäßig
const monitorStreams = async () => {
    for (const channel of Object.keys(config.streamsToMonitor || {})) {
        if (config.streamsToMonitor[channel]) {
            await handleStreamMonitoring(channel);
        }
    }
};

// Funktion zum Neuladen der Konfiguration
const reloadConfig = () => {
    config = loadConfig();
    if (config) {
        console.log('Configuration reloaded successfully.');
        return 'Configuration reloaded successfully.';
    } else {
        console.error('Error reloading configuration.');
        return 'Error reloading configuration.';
    }
};

// Funktion zum Neustarten des Bots
const restartBot = (message) => {
    console.log('Restarting bot...');
    const embed = createEmbed('Bot Restart', 'Bot is restarting...');
    message.reply({ embeds: [embed] });

    // Beenden Sie den aktuellen Bot-Prozess
    client.destroy().then(() => {
        console.log('Bot destroyed. Restarting...');

        // Starten Sie einen neuen Prozess
        const newProcess = spawn('bun', ['run', 'bot.js'], {
            stdio: 'inherit',
            shell: true
        });

        newProcess.on('error', (error) => {
            console.error('Error restarting bot:', error.message);
        });

        // Beenden Sie den aktuellen Prozess
        process.exit();
    }).catch((error) => {
        console.error('Error destroying bot:', error.message);
    });
};

// Funktion zum Anzeigen der Hilfe-Nachricht
const showHelp = (message) => {
    const helpText = `
\`.record <channel>\` - Starts recording the specified channel.
\`.stop <channel>\` - Stops recording the specified channel.
\`.enable <channel>\` - Enables monitoring for the specified channel.
\`.disable <channel>\` - Disables monitoring for the specified channel.
\`.status\` - Shows the current status of all monitored streams.
\`.reload\` - Reloads the configuration from the config file.
\`.restart\` - Restarts the bot.
\`.help\` - Shows this help message.
`;

    message.reply(helpText);
};

// Funktion zum Anzeigen des Überwachungsstatus
const showMonitoringStatus = async (message) => {
    if (statusInProgress) {
        message.reply('Status check is already in progress.');
        return;
    }

    statusInProgress = true;
    try {
        const statuses = [];
        for (const channel of Object.keys(config.streamsToMonitor || {})) {
            const isLive = await checkStreamStatus(channel);
            statuses.push(`${channel}: ${isLive ? 'Live' : 'Not live'}`);
        }
        const embed = createEmbed('Stream Status', `Current stream statuses:\n${statuses.join('\n')}`);
        message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error showing monitoring status:', error.message);
        message.reply('An error occurred while checking the stream statuses.');
    } finally {
        statusInProgress = false;
    }
};

// Event: Nachricht empfangen
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Überprüfen, ob die Nachricht von einem autorisierten Benutzer stammt
    if (message.author.id !== config.authorizedUserId) {
        const embed = createEmbed('Unauthorized', 'You are not authorized to use this bot.', '#ff0000');
        message.reply({ embeds: [embed] });
        return;
    }

    const args = message.content.trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === '.enable') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'No channel specified.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }

        // Füge den Kanal zur Konfiguration hinzu, wenn er nicht vorhanden ist
        if (!config.streamsToMonitor) {
            config.streamsToMonitor = {};
        }
        config.streamsToMonitor[channel] = true;
        saveConfig(config);

        const embed = createEmbed('Monitoring Enabled', `Monitoring enabled for channel: ${channel}`);
        message.reply({ embeds: [embed] });

        // Verhindere doppelte Nachrichten
        const enableMessage = `Monitoring enabled for channel: ${channel}`;
        if (!sentMessages.has(enableMessage)) {
            sentMessages.add(enableMessage);
        }

        handleStreamMonitoring(channel); // Starte die Aufnahme sofort, wenn der Stream live ist

    } else if (command === '.disable') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'No channel specified.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }

        if (config.streamsToMonitor && config.streamsToMonitor[channel]) {
            delete config.streamsToMonitor[channel];
            saveConfig(config);
            stopStream(channel);
            const embed = createEmbed('Monitoring Disabled', `Monitoring disabled for channel: ${channel}`);
            message.reply({ embeds: [embed] });
        } else {
            const embed = createEmbed('Error', `Channel ${channel} is not being monitored.`, '#ff0000');
            message.reply({ embeds: [embed] });
        }

    } else if (command === '.status') {
        await showMonitoringStatus(message);

    } else if (command === '.reload') {
        const result = reloadConfig();
        const embed = createEmbed('Configuration Reloaded', result);
        message.reply({ embeds: [embed] });

    } else if (command === '.restart') {
        restartBot(message);

    } else if (command === '.record') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'No channel specified.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        recordStream(channel);
        const embed = createEmbed('Recording Started', `Started recording for channel: ${channel}`);
        message.reply({ embeds: [embed] });

    } else if (command === '.stop') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'No channel specified.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }

        if (streamProcesses[channel]) {
            stopStream(channel);
            const embed = createEmbed('Recording Stopped', `Stopped recording for channel: ${channel}`);
            message.reply({ embeds: [embed] });
        } else {
            const embed = createEmbed('Error', `No recording process found for channel ${channel}.`, '#ff0000');
            message.reply({ embeds: [embed] });
        }

    } else if (command === '.help') {
        showHelp(message);

    } else {
        const embed = createEmbed('Unknown Command', 'Unknown command.');
        message.reply({ embeds: [embed] });
    }
});

setInterval(monitorStreams, 60000);

// Bot anmelden
client.login(config.discordToken);
