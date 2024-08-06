const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { format } = require('date-fns');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const crypto = require('crypto');

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

let hasSentStartupMessage = false;

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

    if (!hasSentStartupMessage) {
        await sendStartupMessage();
        hasSentStartupMessage = true;
    }
});

// Map zum Speichern der laufenden Prozesse
const streamProcesses = new Map();

// Map zum Speichern der m3u8 Prozesse
const m3u8Processes = new Map();

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
    fs.mkdirSync(channelPath, { recursive: true });

    const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm-ss');
    const filename = path.join(channelPath, `twitch-${channel}-${timestamp}.mp4`);
    const streamlinkCommand = `streamlink "https://www.twitch.tv/${channel}" "best" --twitch-proxy-playlist "${config.twitchProxyPlaylist}" --retry-streams "30" --stdout`;

    console.log(`Start recording for channel: ${channel}`);

    const streamlinkProcess = spawn(streamlinkCommand, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const ffmpegProcess = spawn('ffmpeg', ['-i', '-', '-c', 'copy', filename], {
        stdio: ['pipe', 'inherit', 'inherit'],
    });

    streamlinkProcess.stdout.pipe(ffmpegProcess.stdin);

    streamProcesses.set(channel, { streamlinkProcess, ffmpegProcess });

    streamlinkProcess.on('exit', () => {
        console.log(`Recording stopped for channel: ${channel}`);
        streamProcesses.delete(channel);
        if (config.rcloneEnabled) {
            uploadRecordings(channel);
        }
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
    if (streamProcesses.has(channel)) {
        console.log(`Stopping recording for channel: ${channel}`);

        const { ffmpegProcess, streamlinkProcess } = streamProcesses.get(channel);

        if (ffmpegProcess) {
            try {
                ffmpegProcess.stdin.end();
                ffmpegProcess.kill('SIGTERM');
                console.log(`ffmpeg process stopped for channel: ${channel}`);
            } catch (error) {
                console.error(`Error stopping ffmpeg process for channel ${channel}: ${error.message}`);
            }
        }

        if (streamlinkProcess) {
            try {
                streamlinkProcess.kill('SIGTERM');
                console.log(`streamlink process stopped for channel: ${channel}`);
            } catch (error) {
                console.error(`Error stopping streamlink process for channel ${channel}: ${error.message}`);
            }
        }

        streamProcesses.delete(channel);

        // Der Upload wird jetzt in der 'exit' Event-Handler von streamlinkProcess gehandhabt
    } else {
        console.log(`No recording process found for channel: ${channel}`);
    }
};

// Funktion zum Hochladen der Aufnahmen
const uploadRecordings = (channel) => {
    const channelPath = path.join(config.recordingsPath, channel);
    const files = fs.readdirSync(channelPath);

    files.forEach(file => {
        const filePath = path.join(channelPath, file);
        const rcloneCommand = `rclone copy "${filePath}" "${config.rcloneRemote}:${config.rcloneFolder}/${channel}" --config "${config.rcloneConfigPath}"`;

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

const sentMessages = new Set();

// Überwacht die Streams regelmäßig
const monitorStreams = async () => {
    const discordChannelId = config.discordChannelId;
    const monitoringChannel = client.channels.cache.get(discordChannelId);

    if (!monitoringChannel) {
        console.error(`Channel with ID ${discordChannelId} not found.`);
        return;
    }

    let statusUpdate = '';

    for (const [channel, shouldMonitor] of Object.entries(config.streamsToMonitor || {})) {
        if (shouldMonitor) {
            const isLive = await checkStreamStatus(channel);
            const statusMessage = isLive ? 'LIVE' : 'OFFLINE';

            statusUpdate += `**${channel}** is currently **${statusMessage}**\n`;

            if (isLive && !streamProcesses.has(channel)) {
                console.log(`Channel **${channel}** is live. Starting recording.`);
                recordStream(channel);
            } else if (!isLive && streamProcesses.has(channel)) {
                console.log(`Channel **${channel}** is not live. Stopping recording.`);
                stopStream(channel);
            }
        }
    }

    if (statusUpdate.trim() && !sentMessages.has(statusUpdate.trim())) {
        const embed = createEmbed('Stream Monitoring', statusUpdate.trim(), '#00ff00');
        monitoringChannel.send({ embeds: [embed] });
        sentMessages.add(statusUpdate.trim());
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

    client.destroy().then(() => {
        console.log('Bot destroyed. Restarting...');

        const newProcess = spawn('bun', ['run', 'bot.js'], {
            stdio: 'inherit',
            shell: true
        });

        newProcess.on('error', (error) => {
            console.error('Error restarting bot:', error.message);
        });

        hasSentStartupMessage = false;

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

    try {
        fs.rmSync(channelPath, { recursive: true, force: true });
        console.log(`Successfully deleted local folder for channel: ${channel}`);
    } catch (error) {
        console.error(`Failed to delete local folder for channel ${channel}: ${error.message}`);
    }
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

    const groupedRecordings = recordings.reduce((acc, recording) => {
        if (!acc[recording.channel]) {
            acc[recording.channel] = [];
        }
        acc[recording.channel].push(recording);
        return acc;
    }, {});

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

    const rcloneMkdirCommand = `rclone mkdir "${cloudFolderPath}" --config "${config.rcloneConfigPath}"`;

    console.log(`Executing command to create cloud folder: ${rcloneMkdirCommand}`);

    const rcloneMkdirProcess = spawn(rcloneMkdirCommand, { shell: true });

    rcloneMkdirProcess.stdout.on('data', (data) => {
        console.log(`rclone mkdir output: ${data.toString()}`);
    });

    rcloneMkdirProcess.stderr.on('data', (data) => {
        console.error(`Error output from rclone mkdir command: ${data.toString()}`);
    });

    rcloneMkdirProcess.on('exit', (mkdirCode) => {
        console.log(`rclone mkdir command exited with code: ${mkdirCode}`);

        if (mkdirCode === 0 || mkdirCode === 3) {
            const rcloneCheckCommand = `rclone lsf "${cloudFolderPath}" --config "${config.rcloneConfigPath}"`;

            console.log(`Executing command to check cloud files: ${rcloneCheckCommand}`);

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

// Funktion zum Aufnehmen eines m3u8 Streams
const recordM3u8Stream = (url) => {
    const id = crypto.randomBytes(4).toString('hex');
    const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm-ss');
    const m3u8Folder = path.join(config.recordingsPath, 'm3u8');
    
    // Erstelle den m3u8-Ordner, falls er nicht existiert
    if (!fs.existsSync(m3u8Folder)) {
        fs.mkdirSync(m3u8Folder, { recursive: true });
    }
    
    const filename = path.join(m3u8Folder, `m3u8-${id}-${timestamp}.mp4`);

    console.log(`Start recording m3u8 stream with ID: ${id}`);

    const startRecording = () => {
        const ytDlpProcess = spawn('yt-dlp', [
            '-o', filename,
            '--no-part',
            '--live-from-start',
            '--retry-sleep', '10',
            '--fragment-retries', 'infinite',
            '--hls-use-mpegts', 
            '-f', 'bestvideo+bestaudio/best',  // Versuche die beste Video- und Audioqualität zu kombinieren, falls verfügbar
            url
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        m3u8Processes.set(id, { ytDlpProcess, filename });

        ytDlpProcess.on('exit', (code) => {
            console.log(`Recording stopped for m3u8 stream with ID: ${id}, exit code: ${code}`);
            
            // Überprüfe, ob die Datei existiert und entferne .part, falls vorhanden
            if (fs.existsSync(`${filename}.part`)) {
                fs.renameSync(`${filename}.part`, filename);
                console.log(`Renamed ${filename}.part to ${filename}`);
            }

            // Wenn der Prozess unerwartet beendet wurde, starte ihn neu
            if (code !== 0 && m3u8Processes.has(id)) {
                console.log(`Restarting recording for m3u8 stream with ID: **${id}**`);
                startRecording();
            } else {
                m3u8Processes.delete(id);
                // Starte den Upload-Prozess nach erfolgreicher Aufnahme
                uploadToCloud(filename);
            }
        });
    };

    startRecording();

    return id;
};

// Funktion zum Stoppen eines m3u8 Streams
const stopM3u8Stream = (id) => {
    if (m3u8Processes.has(id)) {
        const { ytDlpProcess, filename: originalFilename } = m3u8Processes.get(id);
        
        // Sende SIGINT anstelle von SIGTERM
        ytDlpProcess.kill('SIGINT');
        
        // Warte auf den Prozess, um ordnungsgemäß zu beenden
        ytDlpProcess.on('exit', (code) => {
            console.log(`yt-dlp process exited with code ${code}`);
            
            let finalFilename = originalFilename;
            
            // Entferne .part Erweiterung, falls vorhanden
            if (fs.existsSync(`${originalFilename}.part`)) {
                fs.renameSync(`${originalFilename}.part`, originalFilename);
                console.log(`Renamed ${originalFilename}.part to ${originalFilename}`);
            }
            
            // Überprüfe, ob die Datei als .mkv gespeichert wurde und benenne sie um
            if (fs.existsSync(`${originalFilename}.mkv`)) {
                finalFilename = originalFilename.replace('.mp4.mkv', '.mp4');
                fs.renameSync(`${originalFilename}.mkv`, finalFilename);
                console.log(`Renamed ${originalFilename}.mkv to ${finalFilename}`);
            }
            
            m3u8Processes.delete(id);
            console.log(`Stopped recording m3u8 stream with ID: ${id}`);
            
            // Starte den Upload-Prozess nach dem Stoppen der Aufnahme
            uploadToCloud(finalFilename);
        });
    } else {
        console.log(`No recording process found for m3u8 stream with ID: ${id}`);
    }
};

// Funktion zum Hochladen der Aufnahmen
const uploadToCloud = (filename) => {
    const channelPath = path.dirname(filename);
    const channel = path.basename(channelPath);
    const rcloneCommand = `rclone copy "${filename}" "${config.rcloneRemote}:${config.rcloneFolder}/${channel}" --config "${config.rcloneConfigPath}"`;

    const rcloneProcess = spawn(rcloneCommand, { shell: true });

    rcloneProcess.on('exit', (code) => {
        if (code === 0) {
            console.log(`Successfully uploaded ${filename} to ${config.rcloneRemote}:${config.rcloneFolder}/${channel}`);
        } else {
            console.error(`Failed to upload ${filename} to ${config.rcloneRemote}:${config.rcloneFolder}/${channel}`);
        }
    });

    rcloneProcess.on('error', (error) => {
        console.error(`Error uploading ${filename}: ${error.message}`);
    });
};

// Event: Nachricht erhalten
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '.start') {
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

    if (command === '.watch') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        config.streamsToMonitor[channel] = true;
        saveConfig(config);
        const embed = createEmbed('Watching', `Started monitoring channel: ${channel}`, '#00ff00');
        message.reply({ embeds: [embed] });
    }

    if (command === '.unwatch') {
        const channel = args[0];
        if (!channel) {
            const embed = createEmbed('Error', 'Please provide a channel name.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        delete config.streamsToMonitor[channel];
        saveConfig(config);
        const embed = createEmbed('Unwatched', `Stopped monitoring channel: ${channel}`, '#ff0000');
        message.reply({ embeds: [embed] });
    }

    if (command === '.watchlist') {
        let statusUpdate = 'Checking stream statuses...\n\n';

        for (const channel of Object.keys(config.streamsToMonitor || {})) {
            const isLive = await checkStreamStatus(channel);
            const statusMessage = isLive ? '**LIVE**' : '**OFFLINE**';
            const color = isLive ? '#00ff00' : '#ff0000';
            statusUpdate += `${channel} is currently ${statusMessage}\n`;
        }

        const embed = createEmbed('Watchlist Status', statusUpdate.trim(), '#0099ff');
        message.reply({ embeds: [embed] });
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

    if (command === '.list') {
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

    if (command === '.record') {
        const url = args[0];
        if (!url) {
            const embed = createEmbed('Error', 'Please provide a m3u8 URL.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        const id = recordM3u8Stream(url);
        const embed = createEmbed('Recording', `Started recording m3u8 stream with ID: ${id}`, '#00ff00');
        message.reply({ embeds: [embed] });
    }

    if (command === '.end') {
        const id = args[0];
        if (!id) {
            const embed = createEmbed('Error', 'Please provide a m3u8 stream ID.', '#ff0000');
            message.reply({ embeds: [embed] });
            return;
        }
        stopM3u8Stream(id);
        const embed = createEmbed('Ended', `Stopped recording m3u8 stream with ID: ${id}`, '#ff0000');
        message.reply({ embeds: [embed] });
    }
});


// Function to display the help message
const showHelp = (message) => {
    const helpText = `
        \`.start <channel>\` - Starts recording the specified channel.
        \`.stop <channel>\` - Stops recording the specified channel.
        \`.record <url>\` - Starts recording an m3u8 stream.
        \`.end <id>\` - Stops recording an m3u8 stream.
        \`.watch <channel>\` - Activates monitoring for the specified channel.
        \`.unwatch <channel>\` - Deactivates monitoring for the specified channel.
        \`.watchlist\` - Shows the current status of monitored channels.
        \`.reload\` - Reloads the configuration file.
        \`.restart\` - Restarts the bot.
        \`.list\` - Lists all recorded files with download links.
        \`.delete <channel>\` - Deletes the local folder for the specified channel.
        \`.upload <channel>\` - Uploads the folder for the specified channel.
        \`.help\` - Displays this help message.
        `;
    const embed = createEmbed('Help', helpText, '#00ff00');
    message.reply({ embeds: [embed] });
};

// Start the bot
client.login(config.discordToken);

// Start monitoring the streams every 60 seconds
setInterval(monitorStreams, 60 * 1000);
