import * as fs from 'fs';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import * as path from 'path';
import * as tmi from 'tmi.js';

interface TwitchMessage {
	timestamp: string;
	channel: string;
	username: string;
	displayName: string;
	message: string;
	userId?: string;
	userColor?: string;
	badges?: tmi.Badges;
	emotes?: { [emoteid: string]: string[] };
}

// Функция для создания директории если её нет
function ensureDirectoryExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

// Функция для создания имени файла для канала
function createLogFileName(channelName: string, startTime: Date): string {
	const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
	return `${channelName}_${timestamp}.csv`;
}

// Функция для записи заголовка CSV
function writeCSVHeader(filePath: string, includeUserInfo: boolean): void {
	let header = 'timestamp,channel,username,displayName,message';
	if (includeUserInfo) {
		header += ',userId,userColor,badges,emotes';
	}
	header += '\n';
	fs.writeFileSync(filePath, header, 'utf8');
}

// Функция для экранирования CSV значений
function escapeCSV(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

// Функция для записи сообщения в CSV
function appendMessageToCSV(
	filePath: string,
	message: TwitchMessage,
	includeUserInfo: boolean,
): void {
	const row = [
		message.timestamp,
		escapeCSV(message.channel),
		escapeCSV(message.username),
		escapeCSV(message.displayName),
		escapeCSV(message.message),
	];

	if (includeUserInfo) {
		row.push(
			message.userId || '',
			message.userColor || '',
			message.badges ? escapeCSV(JSON.stringify(message.badges)) : '',
			message.emotes ? escapeCSV(JSON.stringify(message.emotes)) : '',
		);
	}

	const line = row.join(',') + '\n';
	fs.appendFileSync(filePath, line, 'utf8');
}

export class TwitchChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twitch Chat',
		name: 'twitchChat',
		icon: 'file:twitch.svg',
		group: ['input'],
		version: 1,
		description: 'Read messages from Twitch chat',
		defaults: {
			name: 'Twitch Chat',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'twitchTMIApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Channel Name',
				name: 'channelName',
				type: 'string',
				default: '',
				placeholder: 'channel_name',
				description: 'The name of the Twitch channel to monitor (without #)',
				required: true,
			},
			{
				displayName: 'Duration Type',
				name: 'durationType',
				type: 'options',
				options: [
					{
						name: 'Fixed Duration (MS)',
						value: 'duration',
					},
					{
						name: 'Until Stream Ends',
						value: 'untilEnd',
					},
				],
				default: 'duration',
				description: 'How long to monitor the chat',
			},
			{
				displayName: 'Duration (MS)',
				name: 'duration',
				type: 'number',
				default: 60000,
				description: 'How long to monitor the chat in milliseconds',
				displayOptions: {
					show: {
						durationType: ['duration'],
					},
				},
			},
			{
				displayName: 'Log Directory',
				name: 'logDirectory',
				type: 'string',
				default: './chat-logs',
				description: 'Directory path where chat logs will be stored',
				required: true,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include User Info',
						name: 'includeUserInfo',
						type: 'boolean',
						default: true,
						description: 'Whether to include additional user information (color, badges, emotes)',
					},
					{
						displayName: 'Debug Mode',
						name: 'debug',
						type: 'boolean',
						default: false,
						description: 'Whether to enable debug logging',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const credentials = await this.getCredentials('twitchTMIApi', itemIndex);
				const channelName = this.getNodeParameter('channelName', itemIndex, '') as string;
				const durationType = this.getNodeParameter('durationType', itemIndex) as string;
				const duration = this.getNodeParameter('duration', itemIndex, 60000) as number;
				const logDirectory = this.getNodeParameter(
					'logDirectory',
					itemIndex,
					'./chat-logs',
				) as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					includeUserInfo?: boolean;
					debug?: boolean;
				};

				if (!channelName) {
					throw new NodeOperationError(this.getNode(), 'Channel name is required', { itemIndex });
				}

				// Clean channel name (remove # if present)
				const cleanChannelName = channelName.startsWith('#')
					? channelName.substring(1)
					: channelName;

				// Создаем директорию для логов
				const logsPath = path.resolve(logDirectory);
				ensureDirectoryExists(logsPath);

				// Создаем файл для логов этого канала
				const sessionStartTime = new Date();
				const logFileName = createLogFileName(cleanChannelName, sessionStartTime);
				const logFilePath = path.join(logsPath, logFileName);

				// Записываем заголовок CSV
				writeCSVHeader(logFilePath, options.includeUserInfo || false);

				let messagesCount = 0;
				let isStreamEnded = false;

				// Configure TMI client
				const opts: tmi.Options = {
					options: {
						debug: options.debug || false,
						messagesLogLevel: 'info',
					},
					connection: {
						reconnect: true,
						secure: true,
					},
					identity: {
						username: credentials.username as string,
						password: credentials.oauthToken as string,
					},
					channels: [cleanChannelName],
				};

				const client = new tmi.Client(opts);

				// Set up message handler
				client.on(
					'message',
					(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
						if (self) return;

						const messageData: TwitchMessage = {
							timestamp: new Date().toISOString(),
							channel,
							username: tags.username || 'unknown',
							displayName: tags['display-name'] || tags.username || 'unknown',
							message,
						};

						if (options.includeUserInfo) {
							messageData.userId = tags['user-id'];
							messageData.userColor = tags.color;
							messageData.badges = tags.badges;
							messageData.emotes = tags.emotes;
						}

						// Записываем сообщение в файл
						appendMessageToCSV(logFilePath, messageData, options.includeUserInfo || false);
						messagesCount++;
					},
				);

				// Monitor for stream end (host mode or stream offline notice)
				if (durationType === 'untilEnd') {
					client.on('notice', (_channel: string, msgid: string, message: string) => {
						// Twitch sends various notices when stream ends
						if (
							msgid === 'host_on' ||
							msgid === 'host_target_went_offline' ||
							message.includes('offline') ||
							message.includes('ended')
						) {
							isStreamEnded = true;
						}
					});
				}

				// Connect to Twitch
				await client.connect();

				// Wait for specified duration or until stream ends
				const startTime = Date.now();
				const maxDuration = durationType === 'duration' ? duration : Infinity;

				await new Promise<void>((resolve) => {
					const checkInterval = setInterval(() => {
						const elapsed = Date.now() - startTime;

						if (durationType === 'untilEnd' && isStreamEnded) {
							clearInterval(checkInterval);
							resolve();
						} else if (durationType === 'duration' && elapsed >= maxDuration) {
							clearInterval(checkInterval);
							resolve();
						}
					}, 1000); // Check every second
				});

				// Disconnect from Twitch
				await client.disconnect();

				// Return messages
				returnData.push({
					json: {
						channel: cleanChannelName,
						messagesCount: messagesCount,
						logFilePath: logFilePath,
						logFileName: logFileName,
						startTime: sessionStartTime.toISOString(),
						endTime: new Date().toISOString(),
					},
					pairedItem: itemIndex,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
						pairedItem: itemIndex,
					});
				} else {
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				}
			}
		}

		return [returnData];
	}
}
