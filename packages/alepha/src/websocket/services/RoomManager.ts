import { $logger } from "alepha/logger";

/**
 * Manages WebSocket room memberships
 *
 * Rooms are logical groupings of connections. A connection can be in multiple rooms,
 * and messages can be targeted to specific rooms.
 */
export class RoomManager {
  protected readonly log = $logger();

  /**
   * Maps roomId → Set<connectionId>
   */
  protected readonly rooms = new Map<string, Set<string>>();

  /**
   * Maps connectionId → Set<roomId>
   * Inverse index for fast lookup of connection's rooms
   */
  protected readonly connectionRooms = new Map<string, Set<string>>();

  /**
   * Join a connection to one or more rooms
   */
  public joinRooms(connectionId: string, roomIds: string[]): void {
    for (const roomId of roomIds) {
      this.joinRoom(connectionId, roomId);
    }
  }

  /**
   * Join a connection to a room
   */
  public joinRoom(connectionId: string, roomId: string): void {
    // Add to room
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    room.add(connectionId);

    // Update inverse index
    let connRooms = this.connectionRooms.get(connectionId);
    if (!connRooms) {
      connRooms = new Set();
      this.connectionRooms.set(connectionId, connRooms);
    }
    connRooms.add(roomId);

    this.log.debug(`Connection ${connectionId} joined room ${roomId}`);
  }

  /**
   * Leave a connection from a room
   */
  public leaveRoom(connectionId: string, roomId: string): void {
    // Remove from room
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(connectionId);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    // Update inverse index
    const connRooms = this.connectionRooms.get(connectionId);
    if (connRooms) {
      connRooms.delete(roomId);
      if (connRooms.size === 0) {
        this.connectionRooms.delete(connectionId);
      }
    }

    this.log.debug(`Connection ${connectionId} left room ${roomId}`);
  }

  /**
   * Remove a connection from all rooms
   */
  public leaveAllRooms(connectionId: string): void {
    const connRooms = this.connectionRooms.get(connectionId);
    if (!connRooms) {
      return;
    }

    for (const roomId of connRooms) {
      const room = this.rooms.get(roomId);
      if (room) {
        room.delete(connectionId);
        if (room.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }

    this.connectionRooms.delete(connectionId);
    this.log.debug(`Connection ${connectionId} left all rooms`);
  }

  /**
   * Get all connection IDs in a room
   */
  public getRoomConnections(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room) : [];
  }

  /**
   * Get all room IDs for a connection
   */
  public getConnectionRooms(connectionId: string): string[] {
    const connRooms = this.connectionRooms.get(connectionId);
    return connRooms ? Array.from(connRooms) : [];
  }

  /**
   * Check if a connection is in a room
   */
  public isInRoom(connectionId: string, roomId: string): boolean {
    const connRooms = this.connectionRooms.get(connectionId);
    return connRooms ? connRooms.has(roomId) : false;
  }

  /**
   * Get all active rooms
   */
  public getAllRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get total number of connections across all rooms
   */
  public getTotalConnections(): number {
    return this.connectionRooms.size;
  }

  /**
   * Get room statistics
   */
  public getStats(): {
    totalRooms: number;
    totalConnections: number;
    roomSizes: Map<string, number>;
  } {
    const roomSizes = new Map<string, number>();
    for (const [roomId, connections] of this.rooms) {
      roomSizes.set(roomId, connections.size);
    }

    return {
      totalRooms: this.rooms.size,
      totalConnections: this.connectionRooms.size,
      roomSizes,
    };
  }
}
