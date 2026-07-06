// YouTube Service - OAuth & Upload logic with token refresh
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const logger = require('../utils/logger');

const TOKEN_PATH = path.join(__dirname, '../../token.json');
const CRED_PATH = path.join(__dirname, '../../client_secret.json');

class YouTubeService {
  constructor() {
    this.oauth2Client = null;
    this.credentials = null;
  }

  getOAuth2Client() {
    if (!this.credentials) {
      if (!fs.existsSync(CRED_PATH)) return null;
      this.credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
    }

    if (!this.oauth2Client) {
      const cred = this.credentials.installed || this.credentials.web;
      const redirectUri = (cred.redirect_uris && cred.redirect_uris[0]) || 'http://localhost:3000/oauth2callback';
      this.oauth2Client = new google.auth.OAuth2(cred.client_id, cred.client_secret, redirectUri);

      // Auto-refresh token handler
      this.oauth2Client.on('tokens', (tokens) => {
        logger.info('Token refreshed automatically');
        const existing = this._loadToken() || {};
        const updated = { ...existing, ...tokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      });
    }

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      this.oauth2Client.setCredentials(token);
    }

    return this.oauth2Client;
  }

  _loadToken() {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  }

  isAuthenticated() {
    const client = this.getOAuth2Client();
    if (!client) return { hasCredentials: false, authenticated: false };
    const hasToken = fs.existsSync(TOKEN_PATH);
    return { hasCredentials: true, authenticated: hasToken };
  }

  getAuthUrl() {
    const client = this.getOAuth2Client();
    if (!client) throw new Error('Missing client_secret.json');

    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly'
      ],
      prompt: 'consent'
    });
  }

  async handleCallback(code) {
    const client = this.getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    logger.info('OAuth authentication successful');
    return tokens;
  }

  logout() {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    this.oauth2Client = null;
    logger.info('Logged out from YouTube');
  }

  async uploadVideo({ filepath, title, description, tags, privacy, categoryId, publishAt, madeForKids, onProgress }) {
    const client = this.getOAuth2Client();
    if (!client || !client.credentials || !client.credentials.access_token) {
      throw new Error('Not authenticated with YouTube');
    }

    const youtube = google.youtube({ version: 'v3', auth: client });
    const fileSize = fs.statSync(filepath).size;

    logger.info('Starting upload', { title, filepath, size: fileSize, categoryId, publishAt });

    // Build request body
    const requestBody = {
      snippet: {
        title,
        description: description || '',
        tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
        categoryId: categoryId ? String(categoryId) : '22', // Default: People & Blogs
        defaultLanguage: 'th',
        defaultAudioLanguage: 'th'
      },
      status: {
        privacyStatus: publishAt ? 'private' : (privacy || 'public'),
        selfDeclaredMadeForKids: madeForKids || false,
        embeddable: true,
        publicStatsViewable: true
      }
    };

    // If scheduled publish, set publishAt (video must be private first)
    if (publishAt) {
      requestBody.status.privacyStatus = 'private';
      requestBody.status.publishAt = publishAt;
    }

    const response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody,
      media: {
        body: fs.createReadStream(filepath)
      }
    }, {
      onUploadProgress: (evt) => {
        if (onProgress) {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          onProgress(progress, evt.bytesRead, fileSize);
        }
      }
    });

    const videoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    logger.info('Upload successful', { videoId, title, categoryId, scheduled: !!publishAt });

    return { videoId, youtubeUrl, title: response.data.snippet?.title, scheduled: !!publishAt };
  }

  async getChannelInfo() {
    const client = this.getOAuth2Client();
    if (!client || !client.credentials) return null;

    try {
      const youtube = google.youtube({ version: 'v3', auth: client });
      const response = await youtube.channels.list({
        part: 'snippet,statistics',
        mine: true
      });

      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        return {
          id: channel.id,
          title: channel.snippet.title,
          thumbnail: channel.snippet.thumbnails?.default?.url,
          subscribers: channel.statistics.subscriberCount,
          videoCount: channel.statistics.videoCount
        };
      }
    } catch (err) {
      logger.warn('Failed to get channel info', { error: err.message });
    }
    return null;
  }
}

module.exports = new YouTubeService();
