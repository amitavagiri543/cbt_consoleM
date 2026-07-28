import type { ServerResponse } from "node:http";

export interface SSEClient {
  id: string;
  reply: ServerResponse;
  userId: string;
  role: string;
  examBatchId?: string;
  attemptId?: string;
  connectedAt: number;
  rooms: Set<string>;
  lastWriteAt: number;
}

const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64KB backpressure limit per client

/**
 * SSE Manager — manages Server-Sent Events connections.
 *
 * Designed for 500+ concurrent connections:
 * - O(1) client lookup by ID and by userId (separate indexes)
 * - Backpressure protection (drops slow consumers)
 * - Single shared keep-alive timer (not per-connection)
 * - Room-based broadcasting for efficient fan-out
 */
export class SSEManager {
  private clients = new Map<string, SSEClient>();
  private rooms = new Map<string, Set<string>>(); // room -> client IDs
  private usersIndex = new Map<string, Set<string>>(); // userId -> client IDs
  private clientCounter = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Single shared keep-alive timer for all connections
    // Writes a comment line every 15s to keep connections alive
    this.keepAliveTimer = setInterval(() => {
      this.sendKeepAliveToAll();
    }, 15_000);
    // Don't keep the process alive just for this timer
    if (this.keepAliveTimer.unref) {
      this.keepAliveTimer.unref();
    }
  }

  /**
   * Register a new SSE client.
   */
  add(
    client: Omit<SSEClient, "id" | "connectedAt" | "rooms" | "lastWriteAt">,
  ): SSEClient {
    const id = `sse-${++this.clientCounter}`;
    const sseClient: SSEClient = {
      ...client,
      id,
      connectedAt: Date.now(),
      rooms: new Set(),
      lastWriteAt: Date.now(),
    };
    this.clients.set(id, sseClient);

    // Index by userId for O(1) lookup
    if (!this.usersIndex.has(client.userId)) {
      this.usersIndex.set(client.userId, new Set());
    }
    this.usersIndex.get(client.userId)!.add(id);

    return sseClient;
  }

  join(clientId: string, room: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.rooms.add(room);
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(clientId);
  }

  leaveRoom(clientId: string, room: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.rooms.delete(room);
    this.rooms.get(room)?.delete(clientId);
    if (this.rooms.get(room)?.size === 0) {
      this.rooms.delete(room);
    }
  }

  /**
   * Remove a client entirely (connection closed).
   */
  remove(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    for (const room of client.rooms) {
      this.rooms.get(room)?.delete(clientId);
      if (this.rooms.get(room)?.size === 0) {
        this.rooms.delete(room);
      }
    }
    // Remove from user index
    this.usersIndex.get(client.userId)?.delete(clientId);
    if (this.usersIndex.get(client.userId)?.size === 0) {
      this.usersIndex.delete(client.userId);
    }
    this.clients.delete(clientId);
  }

  /**
   * Send an event to a single client with backpressure protection.
   */
  sendTo(clientId: string, event: string, data: unknown): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    if (client.reply.destroyed || client.reply.writableEnded) return false;

    // Backpressure check — if the socket buffer is too full, drop the client
    // to protect server memory (slow consumer / network issue)
    const socket = client.reply.socket as any;
    if (socket?.writableBuffer) {
      if (socket.writableBuffer.length > MAX_BUFFERED_AMOUNT) {
        this.remove(clientId);
        try {
          client.reply.destroy();
        } catch {}
        return false;
      }
    }

    try {
      client.reply.write(`event: ${event}\n`);
      client.reply.write(`data: ${JSON.stringify(data)}\n\n`);
      client.lastWriteAt = Date.now();
      return true;
    } catch {
      // Write failed — connection is dead, clean up
      this.remove(clientId);
      return false;
    }
  }

  /**
   * Broadcast an event to all clients in a room.
   */
  broadcast(room: string, event: string, data: unknown): number {
    const clientIds = this.rooms.get(room);
    if (!clientIds) return 0;
    let sent = 0;
    for (const clientId of clientIds) {
      if (this.sendTo(clientId, event, data)) sent++;
    }
    return sent;
  }

  /**
   * Get clients by user ID — O(1) via index.
   */
  getByUserId(userId: string): SSEClient | undefined {
    const ids = this.usersIndex.get(userId);
    if (!ids || ids.size === 0) return undefined;
    const firstId = ids.values().next().value;
    if (!firstId) return undefined;
    return this.clients.get(firstId);
  }

  getRoomClients(room: string): SSEClient[] {
    const clientIds = this.rooms.get(room);
    if (!clientIds) return [];
    return Array.from(clientIds)
      .map((id) => this.clients.get(id))
      .filter((c): c is SSEClient => !!c);
  }

  getRoomSize(room: string): number {
    return this.rooms.get(room)?.size ?? 0;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  hasClientsInRoom(room: string): boolean {
    return (this.rooms.get(room)?.size ?? 0) > 0;
  }

  /**
   * Send keep-alive ping to all connected clients.
   * Uses a single iteration over all clients — O(n) but only every 15s.
   */
  private sendKeepAliveToAll(): void {
    for (const [id, client] of this.clients) {
      if (client.reply.destroyed || client.reply.writableEnded) {
        this.remove(id);
        continue;
      }
      try {
        client.reply.write(": keep-alive\n\n");
      } catch {
        this.remove(id);
      }
    }
  }

  /**
   * Get all candidate clients that have an active attemptId.
   * Used by the SSE routes to refresh `attempt:active` Redis keys.
   */
  getCandidateAttemptIds(): Array<{ clientId: string; attemptId: string }> {
    const result: Array<{ clientId: string; attemptId: string }> = [];
    for (const [id, client] of this.clients) {
      if (client.role === "candidate" && client.attemptId) {
        result.push({ clientId: id, attemptId: client.attemptId });
      }
    }
    return result;
  }

  /**
   * Clean up dead connections (call periodically or on memory pressure).
   */
  cleanupDeadConnections(): number {
    let removed = 0;
    for (const [id, client] of this.clients) {
      if (client.reply.destroyed || client.reply.writableEnded) {
        this.remove(id);
        removed++;
      }
    }
    return removed;
  }
}

export const sseManager = new SSEManager();
