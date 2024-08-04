# TwitchRecorder

This repository contains a Discord bot designed to monitor and record Twitch streams. The bot uses various technologies including Node.js, Discord.js, and Twitch API to provide a comprehensive solution for stream management.

## Features

- **Stream Monitoring**: Automatically checks the live status of specified Twitch channels at regular intervals.
- **Stream Recording**: Records live streams using `streamlink` and `ffmpeg`, saving the video files to a designated directory.
- **Dynamic Command Handling**: Allows users to control the bot via Discord commands, including enabling/disabling monitoring, starting/stopping recordings, and more.
- **Configuration Management**: Configuration settings are managed through a `config.json` file, allowing easy adjustments for various parameters.

## Commands

- `.record <channel>`: Starts recording the specified Twitch channel.
- `.stop <channel>`: Stops recording the specified channel.
- `.enable <channel>`: Enables monitoring for the specified channel.
- `.disable <channel>`: Disables monitoring for the specified channel.
- `.status`: Displays the current status of all monitored streams.
- `.reload`: Reloads the configuration from the config file.
- `.restart`: Restarts the bot.
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
- `authorizedUserId`: The Discord user ID of the person authorized to use the bot commands.

## Dependencies

- `discord.js`: For interacting with the Discord API.
- `axios`: For making HTTP requests to Twitch API.
- `streamlink`: For streaming Twitch channels.
- `ffmpeg`: For processing video streams.

## Contribution

Feel free to contribute to this project by submitting issues or pull requests. Ensure that your changes adhere to the existing code style and include appropriate documentation.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
