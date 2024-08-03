import type { ProtocolAdapter, ServerInfo, Credentials, Guild, Channel, Message, PaginationOptions, ServerEvent, Capabilities } from './types.js';

export class MatrixAdapter implements ProtocolAdapter {
  readonly protocol = 'matrix-v1';
  
  private baseUrl = '';
  private accessToken = '';
  private serverId = '';
  private userId = '';
  private syncRunning = false;
  private eventCallbacks: ((event: ServerEvent) => void)[] = [];
  private syncTimeout: any = null;
  
  async connect(server: ServerInfo, credentials: Credentials): Promise<void> {
    this.baseUrl = server.apiUrl;
    this.serverId = server.id;
    
    if (credentials.token) {
      this.accessToken = credentials.token;
    }
    
    // Start sync loop
    this.startSync();
  }
  
  async disconnect(): Promise<void> {
    this.syncRunning = false;
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.eventCallbacks = [];
  }
  
  async login(username: string, password: string): Promise<{ token: string }> {
    const res = await fetch(this.baseUrl + '/_matrix/client/v3/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        user: username,
        password,
      }),
    });
    if (!res.ok) throw new Error('Matrix login failed');
    const data = await res.json() as any;
    this.accessToken = data.access_token;
    this.userId = data.user_id;
    return { token: data.access_token };
  }
  
  async getGuilds(): Promise<Guild[]> {
    // Matrix rooms are guilds
    const res = await fetch(this.baseUrl + '/_matrix/client/v3/joined_rooms', {
      headers: { Authorization: 'Bearer ' + this.accessToken },
    });
    const data = await res.json() as any;
    
    const guilds: Guild[] = [];
    for (const roomId of (data.joined_rooms || [])) {
      try {
        const stateRes = await fetch(
          this.baseUrl + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId) + '/state/m.room.name/',
          { headers: { Authorization: 'Bearer ' + this.accessToken } }
        );
        const state = stateRes.ok ? await stateRes.json() as any : { name: roomId };
        guilds.push({
          id: roomId,
          name: state.name || roomId,
          channels: [{ id: roomId, name: state.name || 'main', type: 0 }],
        });
      } catch {
        guilds.push({ id: roomId, name: roomId, channels: [{ id: roomId, name: 'main', type: 0 }] });
      }
    }
    
    return guilds;
  }
  
  async getChannels(guildId: string): Promise<Channel[]> {
    // Matrix room = single channel
    return [{ id: guildId, name: 'main', type: 0, guildId }];
  }
  
  async getMessages(channelId: string, options?: PaginationOptions): Promise<Message[]> {
    const limit = options?.limit || 50;
    let url = this.baseUrl + '/_matrix/client/v3/rooms/' + encodeURIComponent(channelId) + '/messages?dir=b&limit=' + limit;
    if (options?.before) url += '&from=' + options.before;
    
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + this.accessToken },
    });
    const data = await res.json() as any;
    
    return (data.chunk || [])
      .filter((e: any) => e.type === 'm.room.message')
      .map((e: any) => ({
        id: e.event_id,
        content: e.content?.body || '',
        authorId: e.sender,
        authorName: e.sender.split(':')[0].slice(1),
        channelId,
        timestamp: new Date(e.origin_server_ts).toISOString(),
      }));
  }
  
  async sendMessage(channelId: string, content: string): Promise<Message> {
    const txnId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const res = await fetch(
      this.baseUrl + '/_matrix/client/v3/rooms/' + encodeURIComponent(channelId) + '/send/m.room.message/' + txnId,
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ msgtype: 'm.text', body: content }),
      }
    );
    const data = await res.json() as any;
    return {
      id: data.event_id,
      content,
      authorId: this.userId,
      authorName: this.userId.split(':')[0].slice(1),
      channelId,
      timestamp: new Date().toISOString(),
    };
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
      voiceChannels: false,
      videoChannels: false,
      e2ee: true,
      threads: false,
      reactions: true,
    };
  }
  
  private async startSync() {
    this.syncRunning = true;
    let since: string | undefined;
    
    while (this.syncRunning) {
      try {
        let url = this.baseUrl + '/_matrix/client/v3/sync?timeout=30000';
        if (since) url += '&since=' + since;
        
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + this.accessToken },
        });
        
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        
        const data = await res.json() as any;
        since = data.next_batch;
        
        // Process room events
        const rooms = data.rooms?.join || {};
        for (const [roomId, room] of Object.entries(rooms) as any[]) {
          const timeline = room.timeline?.events || [];
          for (const event of timeline) {
            if (event.type === 'm.room.message') {
              const serverEvent: ServerEvent = {
                type: 'MESSAGE_CREATE',
                serverId: this.serverId,
                data: {
                  id: event.event_id,
                  content: event.content?.body || '',
                  authorId: event.sender,
                  authorName: event.sender.split(':')[0].slice(1),
                  channelId: roomId,
                  timestamp: new Date(event.origin_server_ts).toISOString(),
                },
              };
              this.eventCallbacks.forEach(cb => cb(serverEvent));
            }
          }
        }
      } catch {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}
