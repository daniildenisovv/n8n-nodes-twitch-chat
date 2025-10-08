import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TwitchApi implements ICredentialType {
	name = 'twitchApi';
	displayName = 'Twitch API';
	documentationUrl = 'https://dev.twitch.tv/docs/authentication';
	properties: INodeProperties[] = [
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			placeholder: 'your_twitch_username',
			description: 'Your Twitch username',
		},
		{
			displayName: 'OAuth Token',
			name: 'oauthToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'oauth:xxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
			description:
				'OAuth token for Twitch chat. Get it from <a href="https://twitchapps.com/tmi/" target="_blank">https://twitchapps.com/tmi/</a>',
		},
	];

	// Test the credentials
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://id.twitch.tv',
			url: '/oauth2/validate',
			method: 'GET',
			headers: {
				Authorization: '={{$credentials.oauthToken}}',
			},
		},
	};

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{$credentials.oauthToken}}',
			},
		},
	};
}
