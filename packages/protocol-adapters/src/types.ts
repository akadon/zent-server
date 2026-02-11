// Protocol adapter interface for multi-server support

export interface ServerInfo {
  id: string;
  name: string;
  domain: string;
  apiUrl: string;
  wsUrl: string;
  protocol: string;
}

export interface Credentials {
  token?: string;
  username?: string;
  password?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: number;
  guildId?: string;
  topic?: string;
  position?: number;
}

export interface Message {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  channelId: string;
  timestamp: string;
  attachments?: any[];
  embeds?: any[];
}

export interface Guild {
  id: string;
  name: string;
  icon?: string;
  channels: Channel[];
  memberCount?: number;
}

export interface ServerEvent {
  type: string;
  serverId: string;
  data: any;
}

export interface PaginationOptions {
  before?: string;
  after?: string;
  limit?: number;
}

export interface Capabilities {
  textChannels: boolean;
  voiceChannels: boolean;
  videoChannels: boolean;
  e2ee: boolean;
  threads: boolean;
  reactions: boolean;
}

export interface ProtocolAdapter {
  readonly protocol: string;
  
  connect(server: ServerInfo, credentials: Credentials): Promise<void>;
  disconnect(): Promise<void>;
  
  login(username: string, password: string): Promise<{ token: string }>;
  
  getGuilds(): Promise<Guild[]>;
  getChannels(guildId: string): Promise<Channel[]>;
  getMessages(channelId: string, options?: PaginationOptions): Promise<Message[]>;
  sendMessage(channelId: string, content: string): Promise<Message>;
  
  onEvent(callback: (event: ServerEvent) => void): () => void;
  
  getCapabilities(): Capabilities;
}
