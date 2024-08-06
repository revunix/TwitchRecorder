Hier ist eine aktualisierte Version der Beschreibung, die die neuesten Änderungen und Funktionen berücksichtigt:

# TwitchRecorder

This repository contains a Discord bot designed to monitor and record Twitch streams as well as m3u8 streams. The bot uses various technologies including Node.js, Discord.js, Twitch API, and yt-dlp to provide a comprehensive solution for stream management and recording.

## Features

- **Stream Monitoring**: Automatically checks the live status of specified Twitch channels at regular intervals.
- **Stream Recording**: Records live Twitch streams using `streamlink` and `ffmpeg`, saving the video files to a designated directory.
- **M3U8 Stream Recording**: Records m3u8 streams using `yt-dlp`, supporting various streaming platforms.
- **Dynamic Command Handling**: Allows users to control the bot via Discord commands, including enabling/disabling monitoring, starting/stopping recordings, and managing m3u8 streams.
- **Configuration Management**: Configuration settings are managed through a `config.json` file, allowing easy adjustments for various parameters.
- **Recording Listing**: Lists all recorded streams with clickable links for downloading.
- **Rclone Integration**: Uploads recorded streams to a remote location using `rclone` and manages local files.
- **File Management**: Commands for managing files locally and remotely.

## Commands

- `.start <channel>`: Starts recording the specified Twitch channel.
- `.stop <channel>`: Stops recording the specified Twitch channel.
- `.watch <channel>`: Activates monitoring for the specified Twitch channel.
- `.unwatch <channel>`: Deactivates monitoring for the specified Twitch channel.
- `.watchlist`: Shows the current status of monitored Twitch channels.
- `.record <url>`: Starts recording an m3u8 stream.
- `.end <id>`: Stops recording an m3u8 stream.
- `.reload`: Reloads the configuration from the config file.
- `.restart`: Restarts the bot.
- `.list`: Lists all recorded files with download links.
- `.upload <channel>`: Uploads the local folder for the specified channel to the cloud.
- `.delete <channel>`: Deletes the local folder for the specified channel from the server.
- `.help`: Shows a help message with available commands.

## Setup

1. **Install Dependencies**: Ensure you have Node.js installed, then run `npm install` to install necessary packages.
2. **Configure**: Edit the `config.json` file to include your Discord bot token, Twitch API credentials, and other settings.
3. **Run the Bot**: Start the bot with `node bot.js` or using `bun run bot.js` if you prefer Bun.

## Configuration

The `config.json` file should include:
- `discordToken`: Your Discord bot token.
- `twitchClientId` and `twitchAccessToken`: Your Twitch API credentials.
- `recordingsPath`: Directory where recordings will be saved.
- `discordChannelId`: The Discord channel ID where bot messages will be sent.
- `streamsToMonitor`: A list of Twitch channels to monitor.
- `baseRecordingUrl`: Base URL for accessing recorded streams.
- `rcloneEnabled`: Boolean to enable/disable rclone upload feature.
- `rcloneRemote`: The remote name configured in `rclone`.
- `rcloneFolder`: The folder on the remote where recordings will be uploaded.
- `rcloneConfigPath`: The path to the `rclone.conf` configuration file.
- `twitchProxyPlaylist`: Proxy playlist URL for Twitch streams (if needed).

## Dependencies

- `discord.js`: For interacting with the Discord API.
- `axios`: For making HTTP requests to Twitch API.
- `streamlink`: For streaming Twitch channels.
- `ffmpeg`: For processing video streams.
- `yt-dlp`: For recording m3u8 streams.
- `rclone`: For uploading files to cloud storage.
- `date-fns`: For date formatting.
- `crypto`: For generating unique IDs.

## Contribution

Feel free to contribute to this project by submitting issues or pull requests. Ensure that your changes adhere to the existing code style and include appropriate documentation.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
