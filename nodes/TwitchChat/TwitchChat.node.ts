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
			let messageCount = 0;
			let cleanup: (() => Promise<void>) | null = null;
			const messageBuffer: (string | number)[][] = []; // Буфер для накопления сообщений

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

				// Prepare headers
				const headers = ['Timestamp', 'Channel', 'Username', 'Display Name', 'Message'];

				if (options.includeUserInfo) {
					headers.push('User ID', 'User Color', 'Badges', 'Emotes');
				}

				// Create initial file with headers
				const workbook = new ExcelJS.Workbook();
				const worksheet = workbook.addWorksheet('Twitch Chat Messages');

				// Set column widths
				worksheet.getColumn(1).width = 25; // Timestamp
				worksheet.getColumn(2).width = 20; // Channel
				worksheet.getColumn(3).width = 20; // Username
				worksheet.getColumn(4).width = 20; // Display Name
				worksheet.getColumn(5).width = 50; // Message

				if (options.includeUserInfo) {
					worksheet.getColumn(6).width = 15; // User ID
					worksheet.getColumn(7).width = 15; // User Color
					worksheet.getColumn(8).width = 30; // Badges
					worksheet.getColumn(9).width = 30; // Emotes
				}

				// Add header row with bold style
				const headerRow = worksheet.addRow(headers);
				headerRow.font = { bold: true };

				// Save initial file
				await workbook.xlsx.writeFile(resolvedPath);

				let isStreamEnded = false;

				// Function to append buffered messages to file
				const flushBuffer = async () => {
					if (messageBuffer.length === 0) return; // Nothing to save

					try {
						// Load existing workbook
						const wb = new ExcelJS.Workbook();
						await wb.xlsx.readFile(resolvedPath);

						const ws = wb.getWorksheet('Twitch Chat Messages');
						if (!ws) {
							console.error('Worksheet not found');
							return;
						}

						// Add all buffered messages
						for (const rowData of messageBuffer) {
							ws.addRow(rowData);
						}

						// Save file
						await wb.xlsx.writeFile(resolvedPath);

						// Clear buffer after successful save
						messageBuffer.length = 0;
					} catch (error) {
						console.error('Error flushing buffer:', error);
						// Don't clear buffer on error - will retry next time
					}
				};

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

				// Set up message handler - just add to buffer
				client.on(
					'message',
					(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
						if (self) return;

						// Build row data as array matching header order
						const rowData: (string | number)[] = [
							new Date().toISOString(),
							channel,
							tags.username || 'unknown',
							tags['display-name'] || tags.username || 'unknown',
							message,
						];

						if (options.includeUserInfo) {
							rowData.push(
								tags['user-id'] || '',
								tags.color || '',
								tags.badges ? JSON.stringify(tags.badges) : '',
								tags.emotes ? JSON.stringify(tags.emotes) : '',
							);
						}

						// Add to buffer (not to file yet)
						messageBuffer.push(rowData);
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

				// Flush buffer every 5 seconds
				const saveInterval = setInterval(() => {
					flushBuffer().catch((error) => {
						console.error('Error in periodic flush:', error);
					});
				}, 5000);

				// Setup cleanup handler
				let isCleaningUp = false;
				cleanup = async () => {
					if (isCleaningUp) return;
					isCleaningUp = true;

					// Clear save interval
					clearInterval(saveInterval);

					try {
						await client.disconnect();
					} catch {
						// Ignore disconnect errors
					}

					// Final flush
					await flushBuffer();
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
				// Clean up on error
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
