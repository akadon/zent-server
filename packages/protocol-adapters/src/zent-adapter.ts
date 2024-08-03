import type { ProtocolAdapter, ServerInfo, Credentials, Guild, Channel, Message, PaginationOptions, ServerEvent, Capabilities } from './types.js';
import { io, Socket } from 'socket.io-client';

export class ZentAdapter implements ProtocolAdapter {
  readonly protocol = 'zent-v1';
  
  private apiUrl = '';
  private wsUrl = '';
  private token = '';
  private socket: Socket | null = null;
  private serverId = '';
  private eventCallbacks: ((event: ServerEvent) => void)[] = [];
  
  async connect(server: ServerInfo, credentials: Credentials): Promise<void> {
    this.apiUrl = server.apiUrl;
    this.wsUrl = server.wsUrl;
    this.serverId = server.id;
    
    if (credentials.token) {
      this.token = credentials.token;
    }
    
    // Connect WebSocket gateway
    this.socket = io(this.wsUrl, {
      path: '/gateway',
      transports: ['websocket'],
      auth: { token: this.token },
    });
    
    this.socket.on('dispatch', (event: string, data: any) => {
      const serverEvent: ServerEvent = {
        type: event,
        serverId: this.serverId,
        data,
      };
      this.eventCallbacks.forEach(cb => cb(serverEvent));
    });
  }
  
  async disconnect(): Promise<void> {
    this.socket?.disconnect();
    this.socket = null;
    this.eventCallbacks = [];
  }
  
  async login(username: string, password: string): Promise<{ token: string }> {
    const res = await fetch(this.apiUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: username, password }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    this.token = data.token;
    return { token: data.token };
  }
  
  async getGuilds(): Promise<Guild[]> {
    const res = await fetch(this.apiUrl + '/users/@me/guilds', {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    return res.json();
  }
  
  async getChannels(guildId: string): Promise<Channel[]> {
    const res = await fetch(this.apiUrl + '/guilds/' + guildId + '/channels', {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    return res.json();
  }
  
  async getMessages(channelId: string, options?: PaginationOptions): Promise<Message[]> {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.after) params.set('after', options.after);
    if (options?.limit) params.set('limit', String(options.limit));
    
    const res = await fetch(this.apiUrl + '/channels/' + channelId + '/messages?' + params, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    return res.json();
  }
  
  async sendMessage(channelId: string, content: string): Promise<Message> {
    const res = await fetch(this.apiUrl + '/channels/' + channelId + '/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    return res.json();
  }
  
  onEvent(callback: (event: ServerEvent) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }
  
  getCapabilities(): Capabilities {
    return {
      textChannels: true,
      voiceChannels: true,
      videoChannels: true,
      e2ee: false,
      threads: true,
      reactions: true,
    };
  }
}
