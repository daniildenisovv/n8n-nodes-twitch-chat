# n8n-nodes-twitch-chat

This is an n8n community node that lets you read Twitch chat messages in your n8n workflows.

Twitch is a live streaming platform primarily focused on video game live streaming and esports content. This node allows you to monitor and capture chat messages from any Twitch channel in real-time.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [n8n-nodes-twitch-chat](#n8n-nodes-twitch-chat)
  - [Installation](#installation)
  - [Operations](#operations)
    - [Parameters](#parameters)
  - [Credentials](#credentials)
    - [Prerequisites](#prerequisites)
  - [Compatibility](#compatibility)
  - [Usage](#usage)
    - [Basic Example](#basic-example)
    - [Output Format](#output-format)
    - [Advanced Usage](#advanced-usage)
  - [Resources](#resources)
  - [Version history](#version-history)
    - [0.1.0](#010)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

Or install manually:

```bash
npm install n8n-nodes-twitch-chat
```

## Operations

The Twitch Chat node supports the following operation:

- **Read Chat Messages**: Monitor a Twitch channel's chat and collect messages for a specified duration or until the stream ends

### Parameters

- **Channel Name** (required): The Twitch channel to monitor (without # symbol)
- **Duration Type**:
  - Fixed Duration (MS): Monitor for a specific time in milliseconds
  - Until Stream Ends: Monitor until the stream goes offline
- **Duration (MS)**: Time to monitor in milliseconds (when using Fixed Duration)
- **Log Directory** (required): Directory path where chat logs will be stored (default: `./chat-logs`)
- **Options**:
  - Include User Info: Include detailed user information (badges, emotes, color)
  - Debug Mode: Enable debug logging

## Credentials

To use this node, you need to set up Twitch API credentials:

1. Go to [https://twitchapps.com/tmi/](https://twitchapps.com/tmi/)
2. Click "Connect" and authorize with your Twitch account
3. Copy the OAuth token (starts with `oauth:`)
4. In n8n, create new Twitch API credentials with:
   - **Username**: Your Twitch username
   - **OAuth Token**: The token from step 3

### Prerequisites

- A Twitch account (free to create at [twitch.tv](https://twitch.tv))
- OAuth token from [Twitch Chat OAuth Generator](https://twitchapps.com/tmi/)

## Compatibility

- Minimum n8n version: 1.0.0
- Tested with n8n version: 1.0.0+

## Usage

### Basic Example

1. Add the Twitch Chat node to your workflow
2. Configure credentials
3. Enter a channel name (e.g., `xqc`, `shroud`)
4. Set duration (e.g., 60000 for 1 minute)
5. Run the workflow

The node will return an array of chat messages with timestamps, usernames, and message content.

### Output Format

```json
{
	"channel": "channel_name",
	"messagesCount": 150,
	"logFilePath": "/path/to/chat-logs/channel_name_2025-10-11T10-30-00-000Z.csv",
	"logFileName": "channel_name_2025-10-11T10-30-00-000Z.csv",
	"startTime": "2025-10-11T10:30:00.000Z",
	"endTime": "2025-10-11T10:31:00.000Z"
}
```

Chat messages are saved to CSV files with the following columns:

- `timestamp` - Message timestamp
- `channel` - Channel name
- `username` - Username
- `displayName` - Display name
- `message` - Message content
- (Optional) `userId`, `userColor`, `badges`, `emotes` - Additional user information

### Advanced Usage

See [TWITCH_NODE_USAGE.md](./TWITCH_NODE_USAGE.md) for detailed usage examples and workflows.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Twitch Developer Documentation](https://dev.twitch.tv/docs/)
- [tmi.js Documentation](https://github.com/tmijs/tmi.js)
- [Twitch Chat OAuth Generator](https://twitchapps.com/tmi/)

## Version history

### 0.1.0

- Initial release
- Support for reading chat messages
- Configurable duration or monitor until stream ends
- Optional detailed user information (badges, emotes, colors)
