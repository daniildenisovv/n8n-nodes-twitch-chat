import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import * as tmi from 'tmi.js';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

interface ChatRowData {
	timestamp: string;
	channel: string;
	username: string;
	displayName: string;
	message: string;
	userId?: string;
	userColor?: string;
	badges?: string;
	emotes?: string;
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
				displayName: 'Output File Path',
				name: 'outputFilePath',
				type: 'string',
				default: '',
				placeholder: '/path/to/table/messages.xlsx',
				description: 'Full path to the output XLSX file where messages will be streamed',
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
			let workbook: ExcelJS.stream.xlsx.WorkbookWriter | null = null;
			let worksheet: ExcelJS.Worksheet | null = null;
			let messageCount = 0;
			let cleanup: (() => Promise<void>) | null = null;

			try {
				const credentials = await this.getCredentials('twitchTMIApi', itemIndex);
				const channelName = this.getNodeParameter('channelName', itemIndex, '') as string;
				const durationType = this.getNodeParameter('durationType', itemIndex) as string;
				const duration = this.getNodeParameter('duration', itemIndex, 60000) as number;
				const outputFilePath = this.getNodeParameter('outputFilePath', itemIndex, '') as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					includeUserInfo?: boolean;
					debug?: boolean;
				};

				if (!channelName) {
					throw new NodeOperationError(this.getNode(), 'Channel name is required', { itemIndex });
				}

				if (!outputFilePath) {
					throw new NodeOperationError(this.getNode(), 'Output file path is required', {
						itemIndex,
					});
				}

				// Clean channel name (remove # if present)
				const cleanChannelName = channelName.startsWith('#')
					? channelName.substring(1)
					: channelName;

				// Validate and prepare file path
				const resolvedPath = path.resolve(outputFilePath);
				const dir = path.dirname(resolvedPath);

				// Create directory if it doesn't exist
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
				}

				// Initialize streaming workbook writer
				workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
					filename: resolvedPath,
					useStyles: true,
					useSharedStrings: true,
				});

				worksheet = workbook.addWorksheet('Twitch Chat Messages');

				// Define columns based on whether user info is included
				const columns: Array<{ header: string; key: string; width: number }> = [
					{ header: 'Timestamp', key: 'timestamp', width: 25 },
					{ header: 'Channel', key: 'channel', width: 20 },
					{ header: 'Username', key: 'username', width: 20 },
					{ header: 'Display Name', key: 'displayName', width: 20 },
					{ header: 'Message', key: 'message', width: 50 },
				];

				if (options.includeUserInfo) {
					columns.push(
						{ header: 'User ID', key: 'userId', width: 15 },
						{ header: 'User Color', key: 'userColor', width: 15 },
						{ header: 'Badges', key: 'badges', width: 30 },
						{ header: 'Emotes', key: 'emotes', width: 30 },
					);
				}

				worksheet.columns = columns;

				// Commit the header row
				worksheet.getRow(1).commit();

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

				// Set up message handler with streaming write
				client.on(
					'message',
					(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
						if (self || !worksheet) return;

						const rowData: ChatRowData = {
							timestamp: new Date().toISOString(),
							channel,
							username: tags.username || 'unknown',
							displayName: tags['display-name'] || tags.username || 'unknown',
							message,
						};

						if (options.includeUserInfo) {
							rowData.userId = tags['user-id'] || '';
							rowData.userColor = tags.color || '';
							rowData.badges = tags.badges ? JSON.stringify(tags.badges) : '';
							rowData.emotes = tags.emotes ? JSON.stringify(tags.emotes) : '';
						}

						// Add row and immediately commit to stream
						const row = worksheet.addRow(rowData);
						row.commit();
						messageCount++;
					},
				);

				// Monitor for stream end (host mode or stream offline notice)
				if (durationType === 'untilEnd') {
					client.on('notice', (channel: string, msgid: string, message: string) => {
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

				// Setup cleanup handler
				let isCleaningUp = false;
				cleanup = async () => {
					if (isCleaningUp) return;
					isCleaningUp = true;

					try {
						await client.disconnect();
					} catch {
						// Ignore disconnect errors
					}

					// Finalize the workbook (commit all pending data)
					if (worksheet) {
						worksheet.commit();
					}
					if (workbook) {
						await workbook.commit();
					}
				};

				// Wait for specified duration or until stream ends
				const startTime = Date.now();
				const maxDuration = durationType === 'duration' ? duration : Infinity;

				try {
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
				} finally {
					// Always cleanup on exit (normal or error)
					await cleanup();
				}

				// Return result with file info instead of messages
				returnData.push({
					json: {
						channel: cleanChannelName,
						messagesCount: messageCount,
						outputFile: resolvedPath,
						status: 'success',
					},
					pairedItem: itemIndex,
				});
			} catch (error) {
				// Clean up workbook on error
				if (cleanup) {
					try {
						await cleanup();
					} catch {
						// Ignore cleanup errors
					}
				}

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
