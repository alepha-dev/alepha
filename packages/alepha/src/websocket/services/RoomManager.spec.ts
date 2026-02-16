import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { AlephaWebSocket } from "../index.ts";
import { RoomManager } from "./RoomManager.ts";

describe("RoomManager", () => {
  const createRoomManager = () => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    return alepha.inject(RoomManager);
  };

  describe("joinRoom / joinRooms", () => {
    it("should add connection to a room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");

      expect(rm.getRoomConnections("room-a")).toEqual(["conn-1"]);
      expect(rm.getConnectionRooms("conn-1")).toEqual(["room-a"]);
    });

    it("should add connection to multiple rooms", () => {
      const rm = createRoomManager();
      rm.joinRooms("conn-1", ["room-a", "room-b", "room-c"]);

      expect(rm.getConnectionRooms("conn-1")).toEqual(
        expect.arrayContaining(["room-a", "room-b", "room-c"]),
      );
      expect(rm.getRoomConnections("room-a")).toEqual(["conn-1"]);
      expect(rm.getRoomConnections("room-b")).toEqual(["conn-1"]);
    });

    it("should allow multiple connections in the same room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      rm.joinRoom("conn-2", "room-a");
      rm.joinRoom("conn-3", "room-a");

      expect(rm.getRoomConnections("room-a")).toHaveLength(3);
    });
  });

  describe("leaveRoom", () => {
    it("should remove connection from room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      rm.leaveRoom("conn-1", "room-a");

      expect(rm.getRoomConnections("room-a")).toEqual([]);
      expect(rm.getConnectionRooms("conn-1")).toEqual([]);
    });

    it("should clean up empty rooms", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      rm.leaveRoom("conn-1", "room-a");

      expect(rm.getAllRooms()).toEqual([]);
    });

    it("should not affect other connections in the same room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      rm.joinRoom("conn-2", "room-a");
      rm.leaveRoom("conn-1", "room-a");

      expect(rm.getRoomConnections("room-a")).toEqual(["conn-2"]);
    });

    it("should handle leaving a room the connection is not in", () => {
      const rm = createRoomManager();
      rm.leaveRoom("conn-1", "room-a");

      expect(rm.getAllRooms()).toEqual([]);
    });
  });

  describe("leaveAllRooms", () => {
    it("should remove connection from all rooms", () => {
      const rm = createRoomManager();
      rm.joinRooms("conn-1", ["room-a", "room-b", "room-c"]);
      rm.leaveAllRooms("conn-1");

      expect(rm.getConnectionRooms("conn-1")).toEqual([]);
      expect(rm.getAllRooms()).toEqual([]);
    });

    it("should not affect other connections", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      rm.joinRoom("conn-2", "room-a");
      rm.joinRoom("conn-1", "room-b");
      rm.leaveAllRooms("conn-1");

      expect(rm.getRoomConnections("room-a")).toEqual(["conn-2"]);
      expect(rm.getConnectionRooms("conn-2")).toEqual(["room-a"]);
    });

    it("should be a no-op for unknown connection", () => {
      const rm = createRoomManager();
      rm.leaveAllRooms("unknown");
      expect(rm.getTotalConnections()).toBe(0);
    });
  });

  describe("isInRoom", () => {
    it("should return true when connection is in room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      expect(rm.isInRoom("conn-1", "room-a")).toBe(true);
    });

    it("should return false when connection is not in room", () => {
      const rm = createRoomManager();
      rm.joinRoom("conn-1", "room-a");
      expect(rm.isInRoom("conn-1", "room-b")).toBe(false);
    });

    it("should return false for unknown connection", () => {
      const rm = createRoomManager();
      expect(rm.isInRoom("unknown", "room-a")).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const rm = createRoomManager();
      rm.joinRooms("conn-1", ["room-a", "room-b"]);
      rm.joinRoom("conn-2", "room-a");
      rm.joinRoom("conn-3", "room-b");

      const stats = rm.getStats();
      expect(stats.totalRooms).toBe(2);
      expect(stats.totalConnections).toBe(3);
      expect(stats.roomSizes.get("room-a")).toBe(2);
      expect(stats.roomSizes.get("room-b")).toBe(2);
    });

    it("should return empty stats when no connections", () => {
      const rm = createRoomManager();
      const stats = rm.getStats();
      expect(stats.totalRooms).toBe(0);
      expect(stats.totalConnections).toBe(0);
      expect(stats.roomSizes.size).toBe(0);
    });
  });
});
