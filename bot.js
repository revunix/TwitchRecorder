const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { format } = require('date-fns');
const { Client, GatewayIntentBits, MessageEmbed } = require('discord.js');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

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

let hasSentStartupMessage = false; // Variable zum Verfolgen des Nachrichtenstatus

// Funktion zum Senden der Startnachricht
const sendStartupMessage = async () => {
    const discordChannelId = config.discordChannelId;
    const monitoringChannel = client.channels.cache.get(discordChannelId);

    if (!monitoringChannel) {
        console.error(`Channel with ID ${discordChannelId} not found.`);
        return;
    }

    const message = "Checking is live, waiting for streamers...";
    const embed = createEmbed('Stream Monitoring', message, '#7cfc00');

    await monitoringChannel.send({ embeds: [embed] });
};

// Event: Bot ist bereit
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready to handle commands.');

    // Sende die Startnachricht nur beim ersten Start
    if (!hasSentStartupMessage) {
        await sendStartupMessage();
        hasSentStartupMessage = true;
    }
});

// Variable zum Speichern der laufenden Prozesse
const streamProcesses = {};

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
    const filename = path.join(channelPath, `twitch-${channel}-${timestamp}.mp4`);
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

        // Überprüfen, ob Rclone-Upload aktiviert ist
        if (config.rcloneEnabled) {
            // Lokaler Pfad zur aufgezeichneten Datei
            const channelPath = path.join(config.recordingsPath, channel);
            const files = fs.readdirSync(channelPath);

            files.forEach(file => {
                const filePath = path.join(channelPath, file);

                // Rclone-Befehl zum Hochladen der Datei
                const rcloneCommand = `rclone copy "${filePath}" "${config.rcloneRemote}:${config.rcloneFolder}/${channel}" --config "${config.rcloneConfigPath}"`;

                // Ausführen des Rclone-Befehls
                const rcloneProcess = spawn(rcloneCommand, { shell: true });

                rcloneProcess.on('exit', (code) => {
                    if (code === 0) {
                        console.log(`Successfully uploaded ${filePath} to ${config.rcloneRemote}:${config.rcloneFolder}/${channel}`);
                    } else {
                        console.error(`Failed to upload ${filePath} to ${config.rcloneRemote}:${config.rcloneFolder}/${channel}`);
                    }
                });

                rcloneProcess.on('error', (error) => {
                    console.error(`Error uploading ${filePath}: ${error.message}`);
                });
            });
        }
    } else {
        console.log(`No recording process found for channel: ${channel}`);
    }
};

// Funktion zum Überprüfen des Live-Status eines Streams
const checkStreamStatus = async (channel) => {
    try {
        console.log(`Checking stream status for channel: ${channel} at ${new Date().toISOString()}`);
        const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
            headers: {
                'Client-ID': config.twitchClientId,
                'Authorization': `Bearer ${config.twitchAccessToken}`,
            },
        });

        const stream = response.data.data[0];
        const isLive = stream ? stream.type === 'live' : false;
        console.log(`Stream status for ${channel}: ${isLive ? 'LIVE' : 'OFFLINE'} at ${new Date().toISOString()}`);
        return isLive;
    } catch (error) {
        console.error(`Error checking stream status for ${channel}: ${error.message}`);
        return false;
    }
};

const sentMessages = new Set(); // Set zum Speichern bereits gesendeter Nachrichten

// Funktion zum Starten der Aufzeichnung basierend auf dem Live-Status
const handleStreamMonitoring = async (channel) => {
    const isLive = await checkStreamStatus(channel);

    // Nachricht zum Monitoring nur zurückgeben, anstatt sie direkt zu senden
    return `${channel}`;
};

// Überwacht die Streams regelmäßig
const monitorStreams = async () => {
    const discordChannelId = config.discordChannelId;
    const monitoringChannel = client.channels.cache.get(discordChannelId);

    if (!monitoringChannel) {
        console.error(`Channel with ID ${discordChannelId} not found.`);
        return;
    }

    const channels = [];
    let statusUpdate = '';

    for (const channel of Object.keys(config.streamsToMonitor || {})) {
        if (config.streamsToMonitor[channel]) {
            // Check the live status of the channel
            const isLive = await checkStreamStatus(channel);
            const statusMessage = isLive ? 'LIVE' : 'OFFLINE';

            // Add status to the update message
            statusUpdate += `**${channel}** is currently **${statusMessage}**\n`;

            // Start or stop recording based on status
            if (isLive) {
                if (!streamProcesses[channel]) {
                    console.log(`Channel **${channel}** is live. Starting recording.`);
                    recordStream(channel);
                }
            } else {
                if (streamProcesses[channel]) {
                    console.log(`Channel **${channel}** is not live. Stopping recording.`);
                    stopStream(channel);
                }
            }
        }
    }

    // Send consolidated status update if there are changes
    if (statusUpdate.trim()) {
        const embed = createEmbed('Stream Monitoring', statusUpdate.trim(), '#00ff00');
        if (!sentMessages.has(statusUpdate.trim())) {
            monitoringChannel.send({ embeds: [embed] });
            sentMessages.add(statusUpdate.trim());
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
    const embed = createEmbed('Bot Restart', 'Bot is restarting...', '#ff0000');
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

        // Setze die Variable zurück, um die Nachricht nach dem Neustart zu senden
        hasSentStartupMessage = false;

        // Beenden Sie den aktuellen Prozess
        process.exit();
    }).catch((error) => {
        console.error('Error destroying bot:', error.message);
    });
};
// Funktion zum Löschen des Ordners für einen bestimmten Kanal vom lokalen Server
const deleteChannelFolder = (channel) => {
    const channelPath = path.join(config.recordingsPath, channel);

    if (!fs.existsSync(channelPath)) {
        console.error(`Channel path ${channelPath} does not exist.`);
        return;
    }

    // Löschen des Ordners und aller darin enthaltenen Dateien
    try {
        fs.rmSync(channelPath, { recursive: true, force: true });
        console.log(`Successfully deleted local folder for channel: ${channel}`);
    } catch (error) {
        console.error(`Failed to delete local folder for channel ${channel}: ${error.message}`);
    }
};
// Funktion zum Anzeigen der Hilfe-Nachricht
const showHelp = (message) => {
    const helpText = `
        \`.record <channel>\` - Starts recording the specified channel.
        \`.stop <channel>\` - Stops recording the specified channel.
        \`.enable <channel>\` - Enables monitoring for the specified channel.
        \`.disable <channel>\` - Disables monitoring for the specified channel.
        \`.status\` - Shows the current status of the monitored channels.
        \`.reload\` - Reloads the configuration file.
        \`.restart\` - Restarts the bot.
        \`.recordings\` - Lists all recorded files with download links.
        `;
    const embed = createEmbed('Help', helpText, '#00ff00');
    message.reply({ embeds: [embed] });
};

// Funktion zum Auflisten der Aufzeichnungen
const listRecordings = () => {
    const baseRecordingUrl = config.baseRecordingUrl;
    const recordingsPath = config.recordingsPath;

    const recordings = [];

    const channels = fs.readdirSync(recordingsPath);
    channels.forEach(channel => {
        const channelPath = path.join(recordingsPath, channel);
        const files = fs.readdirSync(channelPath);

        files.forEach(file => {
            const filePath = path.join(channelPath, file);
            const fileUrl = `${baseRecordingUrl}${channel}/${file}`;
            recordings.push({
                channel,
                file,
                url: fileUrl,
                timestamp: fs.statSync(filePath).mtime
            });
        });
    });

    return recordings;
};

// Funktion zum Anzeigen der Aufzeichnungen
const showRecordings = (message) => {
    const recordings = listRecordings();

    if (recordings.length === 0) {
        const embed = createEmbed('Recordings', 'No recordings found.', '#ff0000');
        message.reply({ embeds: [embed] });
        return;
    }

    // Gruppiere Aufzeichnungen nach Kanal
    const groupedRecordings = recordings.reduce((acc, recording) => {
        if (!acc[recording.channel]) {
            acc[recording.channel] = [];
        }
        acc[recording.channel].push(recording);
        return acc;
    }, {});

    // Erstelle die Beschreibung für das Embed
    let description = '';
    for (const [channel, records] of Object.entries(groupedRecordings)) {
        description += `**${channel}:**\n`;
        records.forEach(recording => {
            description += `[${recording.file}](${recording.url})\n`;
        });
        description += '\n';
    }

    const embed = createEmbed('Recordings', description, '#0099ff');
    message.reply({ embeds: [embed] });
};

// Funktion zum Hochladen eines Ordners
const uploadChannelFolder = (channel) => {
    const channelPath = path.join(config.recordingsPath, channel);
    if (!fs.existsSync(channelPath)) {
        console.error(`Channel path ${channelPath} does not exist.`);
        return;
    }

    const cloudFolderPath = `${config.rcloneRemote}:${config.rcloneFolder}/${channel}`;

    // Verzeichnis in der Cloud erstellen, falls es nicht existiert
    const rcloneMkdirCommand = `rclone mkdir "${cloudFolderPath}" --config "${config.rcloneConfigPath}"`;

    console.log(`Executing command to create cloud folder: ${rcloneMkdirCommand}`); // Debugging log

    const rcloneMkdirProcess = spawn(rcloneMkdirCommand, { shell: true });

    rcloneMkdirProcess.stdout.on('data', (data) => {
        console.log(`rclone mkdir output: ${data.toString()}`); // Debugging log
    });

    rcloneMkdirProcess.stderr.on('data', (data) => {
        console.error(`Error output from rclone mkdir command: ${data.toString()}`); // Debugging log
    });

    rcloneMkdirProcess.on('exit', (mkdirCode) => {
        console.log(`rclone mkdir command exited with code: ${mkdirCode}`); // Debugging log

        if (mkdirCode === 0 || mkdirCode === 3) { // 3 bedeutet Verzeichnis existiert bereits
            const rcloneCheckCommand = `rclone lsf "${cloudFolderPath}" --config "${config.rcloneConfigPath}"`;

            console.log(`Executing command to check cloud files: ${rcloneCheckCommand}`); // Debugging log

            // Überprüfen, ob die Daten bereits in der Cloud vorhanden sind
            const rcloneCheckProcess = spawn(rcloneCheckCommand, { shell: true });

            let cloudFiles = '';
            rcloneCheckProcess.stdout.on('data', (data) => {
                cloudFiles += data.toString();
            });

            rcloneCheckProcess.stderr.on('data', (data) => {
                console.error(`Error output from rclone check command: ${data.toString()}`); // Debugging log
            });

            rcloneCheckProcess.on('exit', (code) => {
                console.log(`rclone check command exited with code: ${code}`); // Debugging log

                if (code === 0) {
                    console.log(`Cloud files for channel ${channel}: ${cloudFiles}`); // Debugging log

                    const localFiles = fs.readdirSync(channelPath);
                    console.log(`Local files for channel ${channel}: ${localFiles}`); // Debugging log

                    const cloudFilesList = cloudFiles.split('\n').filter(file => file.trim() !== '');
                    console.log(`Filtered cloud files list for channel ${channel}: ${cloudFilesList}`); // Debugging log

                    // Filter local files to include only .mp4 files
                    const localMp4Files = localFiles.filter(file => file.endsWith('.mp4'));
                    const filesToUpload = localMp4Files.filter(file => !cloudFilesList.includes(file));
                    console.log(`Files to upload for channel ${channel}: ${filesToUpload}`); // Debugging log

                    if (filesToUpload.length === 0) {
                        console.log(`All .mp4 files for channel ${channel} are already in the cloud.`);
                        return;
                    }

                    // Rclone-Befehl zum Hochladen des Ordners mit --include
                    const rcloneCommand = `rclone copy "${channelPath}" "${cloudFolderPath}" --include "*.mp4" --config "${config.rcloneConfigPath}"`;
                    console.log(`Executing command to upload files: ${rcloneCommand}`); // Debugging log

                    // Ausführen des Rclone-Befehls
                    const rcloneProcess = spawn(rcloneCommand, { shell: true });

                    rcloneProcess.on('exit', (uploadCode) => {
                        console.log(`rclone upload command exited with code: ${uploadCode}`); // Debugging log

                        if (uploadCode === 0) {
                            console.log(`Successfully uploaded .mp4 files from folder ${channelPath} to ${cloudFolderPath}`);
                        } else {
                            console.error(`Failed to upload .mp4 files from folder ${channelPath} to ${cloudFolderPath}`);
                        }
                    });

                    rcloneProcess.on('error', (error) => {
                        console.error(`Error uploading .mp4 files from folder ${channelPath}: ${error.message}`);
                    });
                } else {
                    console.error(`Failed to check cloud files for channel ${channel}`);
                }
            });

            rcloneCheckProcess.on('error', (error) => {
                console.error(`Error checking cloud files for channel ${channel}: ${error.message}`);
            });
        } else {
            console.error(`Failed to create cloud folder ${cloudFolderPath}`);
        }
    });

    rcloneMkdirProcess.on('error', (error) => {
        console.error(`Error creating cloud folder ${cloudFolderPath}: ${error.message}`);
    });
};

// Event: Nachricht erhalten
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '.record') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        recordStream(channel);
        const embed = createEmbed('Recording', `Started recording for channel: ${channel}`, '#00ff00');
        message.reply({ embeds: [embed] });
    }

    if (command === '.stop') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        stopStream(channel);
        const embed = createEmbed('Stopped', `Stopped recording for channel: ${channel}`, '#ff0000');
        message.reply({ embeds: [embed] });
    }

    if (command === '.enable') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        config.streamsToMonitor[channel] = true;
        saveConfig(config);
        const embed = createEmbed('Enabled', `Enabled monitoring for channel: ${channel}`, '#00ff00');
        message.reply({ embeds: [embed] });
    }

    if (command === '.disable') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        delete config.streamsToMonitor[channel];
        saveConfig(config);
        const embed = createEmbed('Disabled', `Disabled monitoring for channel: ${channel}`, '#ff0000');
        message.reply({ embeds: [embed] });
    }

    if (command === '.status') {
        const embed = createEmbed('Status', 'Checking stream statuses...', '#0099ff');
        message.reply({ embeds: [embed] });

        for (const channel of Object.keys(config.streamsToMonitor || {})) {
            const isLive = await checkStreamStatus(channel);
            const statusMessage = isLive ? 'LIVE' : 'OFFLINE';
            const embed = createEmbed('Status', `${channel} is currently ${statusMessage}`, isLive ? '#00ff00' : '#ff0000');
            message.reply({ embeds: [embed] });
        }
    }

    if (command === '.reload') {
        const response = reloadConfig();
        const embed = createEmbed('Reload Config', response, response.includes('Error') ? '#ff0000' : '#00ff00');
        message.reply({ embeds: [embed] });
    }

    if (command === '.restart') {
        restartBot(message);
    }

    if (command === '.help') {
        showHelp(message);
    }

    if (command === '.recordings') {
        showRecordings(message);
    }
    if (command === '.delete') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        deleteChannelFolder(channel);
        const embed = createEmbed('Deleted', `Deleted local folder for channel: ${channel}`, '#ff0000');
        message.reply({ embeds: [embed] });
    }
    if (command === '.upload') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        uploadChannelFolder(channel);
        const embed = createEmbed('Uploading', `Started uploading folder for channel: ${channel}`, '#00ff00');
        message.reply({ embeds: [embed] });
    }
});

// Starten Sie den Bot
client.login(config.discordToken);

// Starte das Monitoring der Streams alle 60 Sekunden
setInterval(monitorStreams, 60 * 1000);
