import { useInject } from "@alepha/react";
import { useRoom } from "@alepha/react/websocket";
import type { Static } from "alepha";
import { useState } from "react";
import { ChatClient } from "./ChatClient.ts";
import type { chatInSchema } from "./chatChannel.ts";

type ChatMessage = Static<typeof chatInSchema>;

export function Chat() {
  const chatClient = useInject(ChatClient);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const roomId = "lobby";

  const chat = useRoom(
    {
      roomId,
      channel: chatClient.chatChannel,
      handler: (message) => {
        setMessages((prev) => [...prev, message]);
      },
    },
    [roomId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    await chat.send({ content: input });
    setInput("");
  };

  return (
    <div>
      <h1>WebSocket Chat</h1>
      <p>
        Status:{" "}
        {chat.isConnected
          ? "Connected"
          : chat.isConnecting
            ? "Connecting..."
            : "Disconnected"}
      </p>

      <div
        style={{
          border: "1px solid #ccc",
          height: "300px",
          overflowY: "auto",
          padding: "10px",
          marginBottom: "10px",
        }}
      >
        {messages.map((msg, i) => (
          <div key={i}>
            <strong>{msg.username}:</strong> {msg.content}
            <small style={{ marginLeft: "10px", color: "#666" }}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </small>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={!chat.isConnected}
          style={{ width: "300px", marginRight: "10px" }}
        />
        <button type="submit" disabled={!chat.isConnected}>
          Send
        </button>
      </form>
    </div>
  );
}
