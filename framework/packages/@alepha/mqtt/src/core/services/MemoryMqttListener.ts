import { createServer, type Server, type Socket } from "node:net";
import { createServer as createTlsServer } from "node:tls";

import { AlephaError } from "alepha";
import mqttPacket, { type IConnectPacket, type Packet } from "mqtt-packet";

import type {
  MqttMessage,
  MqttQoS,
  MqttWill,
} from "../providers/MqttClientProvider.ts";
import type {
  MemoryMqttBroker,
  MemoryMqttSession,
} from "./MemoryMqttBroker.ts";

export interface MemoryMqttListenOptions {
  /**
   * Where to listen: the loopback only (`127.0.0.1`, `::1`, `localhost`).
   */
  host?: string;
  /**
   * 0 picks a free port.
   */
  port?: number;
  /**
   * PEM certificate (with its chain) and key: the listener speaks TLS.
   */
  tls?: { cert: string; key: string };
  /**
   * Whether a CONNECT may open a session. Refused, the client gets CONNACK
   * 5 (MQTT 3.1.1) or 135 (MQTT 5). Absent, every client is accepted.
   */
  authenticate?: (login: {
    clientId: string;
    username?: string;
    password?: string;
  }) => boolean | Promise<boolean>;
}

/**
 * An open listener of a `MemoryMqttBroker`.
 */
export interface MemoryMqttListener {
  /**
   * `mqtt://127.0.0.1:<port>` (or `mqtts://`), for a client to connect to.
   */
  url: string;
  port: number;
  /**
   * Stops listening and drops every connection (their wills are published).
   */
  close(): Promise<void>;
}

/**
 * A `MemoryMqttBroker` on a socket: the in-process broker reachable by
 * other processes (a device agent written in another language, a CLI), on
 * the loopback only. MQTT 3.1.1 and 5, through `mqtt-packet`; the broker's
 * own semantics apply (routing, retained, shared subscriptions, wills).
 *
 * - CONNECT checked by `authenticate`; a second connection with a client id
 *   already connected takes the session over, the first is dropped
 * - PUBLISH QoS 0 and 1 both ways (QoS 2 is served as QoS 1)
 * - a socket closed without DISCONNECT, or silent past one and a half
 *   keepalives, publishes the session's will
 */
export class MemoryMqttListenerServer {
  public static readonly LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

  protected readonly broker: MemoryMqttBroker;
  protected readonly options: MemoryMqttListenOptions;
  protected readonly clients = new Map<string, MemoryMqttConnection>();
  protected readonly connections = new Set<MemoryMqttConnection>();
  protected server: Server | undefined;

  public constructor(
    broker: MemoryMqttBroker,
    options: MemoryMqttListenOptions,
  ) {
    this.broker = broker;
    this.options = options;
  }

  public async listen(): Promise<MemoryMqttListener> {
    const host = this.options.host ?? "127.0.0.1";
    if (!MemoryMqttListenerServer.LOOPBACK.has(host)) {
      throw new AlephaError(
        `the memory MQTT broker listens on the loopback only, not ${host}`,
      );
    }
    const onSocket = (socket: Socket) => {
      const connection = new MemoryMqttConnection(this, socket);
      this.connections.add(connection);
      socket.once("close", () => this.connections.delete(connection));
    };
    const server = this.options.tls
      ? createTlsServer(
          { cert: this.options.tls.cert, key: this.options.tls.key },
          onSocket,
        )
      : createServer(onSocket);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port ?? 0, host, () => resolve());
    });
    this.server = server;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const scheme = this.options.tls ? "mqtts" : "mqtt";
    const shown = host.includes(":") ? `[${host}]` : host;
    return {
      url: `${scheme}://${shown}:${port}`,
      port,
      close: () => this.close(),
    };
  }

  public async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const connection of Array.from(this.connections)) {
      await connection.drop();
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /**
   * @internal
   */
  public async authenticate(packet: IConnectPacket): Promise<boolean> {
    if (!this.options.authenticate) {
      return true;
    }
    return this.options.authenticate({
      clientId: packet.clientId,
      username: packet.username,
      password:
        packet.password === undefined
          ? undefined
          : Buffer.from(packet.password).toString("utf8"),
    });
  }

  /**
   * @internal
   */
  public async claim(
    clientId: string,
    connection: MemoryMqttConnection,
  ): Promise<void> {
    const previous = this.clients.get(clientId);
    this.clients.set(clientId, connection);
    if (previous && previous !== connection) {
      await previous.drop();
    }
  }

  /**
   * @internal
   */
  public release(clientId: string, connection: MemoryMqttConnection): void {
    if (this.clients.get(clientId) === connection) {
      this.clients.delete(clientId);
    }
  }

  /**
   * @internal
   */
  public get memoryBroker(): MemoryMqttBroker {
    return this.broker;
  }
}

/**
 * One client connection: a session of the memory broker.
 *
 * @internal
 */
export class MemoryMqttConnection implements MemoryMqttSession {
  protected readonly server: MemoryMqttListenerServer;
  protected readonly socket: Socket;
  protected readonly parser: ReturnType<typeof mqttPacket.parser>;
  protected protocolVersion: 3 | 4 | 5 = 4;
  protected clientId = "";
  protected connected = false;
  protected closed = false;
  protected willMessage: MqttWill | undefined;
  protected nextId = 1;
  protected keepaliveTimer: ReturnType<typeof setTimeout> | undefined;
  protected keepaliveMs = 0;
  /**
   * Packets handled one at a time, in order.
   */
  protected queue: Promise<void> = Promise.resolve();

  public constructor(server: MemoryMqttListenerServer, socket: Socket) {
    this.server = server;
    this.socket = socket;
    this.parser = mqttPacket.parser({ protocolVersion: 4 });
    this.parser.on("packet", (packet) => {
      // The packets after CONNECT parse in its protocol version, and they
      // may arrive in the same chunk: set it before the next one.
      if (packet.cmd === "connect") {
        (
          this.parser as unknown as { settings: { protocolVersion: number } }
        ).settings.protocolVersion = packet.protocolVersion ?? 4;
      }
      this.queue = this.queue
        .then(() => this.handle(packet))
        .catch(() => this.drop());
    });
    this.parser.on("error", () => void this.drop());
    socket.on("data", (chunk) => {
      this.touch();
      this.parser.parse(chunk as Buffer);
    });
    socket.on("error", () => undefined);
    socket.once("close", () => void this.drop());
  }

  // MemoryMqttSession

  public async deliver(
    message: MqttMessage,
    ids: number[] | undefined,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    const qos: MqttQoS = message.qos >= 1 ? 1 : 0;
    const properties: Record<string, unknown> = {};
    if (this.protocolVersion === 5) {
      if (ids?.length) {
        properties.subscriptionIdentifier = ids.length === 1 ? ids[0] : ids;
      }
      if (message.responseTopic) {
        properties.responseTopic = message.responseTopic;
      }
      if (message.correlationData) {
        properties.correlationData = Buffer.from(message.correlationData);
      }
    }
    this.send({
      cmd: "publish",
      topic: message.topic,
      payload: Buffer.from(message.payload),
      qos,
      retain: message.retain,
      dup: false,
      ...(qos ? { messageId: this.messageId() } : {}),
      ...(Object.keys(properties).length ? { properties } : {}),
    } as Packet);
  }

  public will(): MqttWill | undefined {
    return this.willMessage;
  }

  /**
   * Closes the socket as a network cut: the broker publishes the will.
   */
  public async drop(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.keepaliveTimer);
    this.socket.destroy();
    if (this.connected) {
      this.connected = false;
      this.server.release(this.clientId, this);
      await this.server.memoryBroker.drop(this);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  protected async handle(packet: Packet): Promise<void> {
    if (this.closed) {
      return;
    }
    if (!this.connected && packet.cmd !== "connect") {
      await this.drop();
      return;
    }
    switch (packet.cmd) {
      case "connect":
        return this.onConnect(packet);
      case "publish": {
        const qos: MqttQoS = (packet.qos ?? 0) >= 1 ? 1 : 0;
        await this.server.memoryBroker.publish(
          packet.topic,
          new Uint8Array(
            typeof packet.payload === "string"
              ? Buffer.from(packet.payload)
              : packet.payload,
          ),
          {
            qos,
            retain: packet.retain ?? false,
            responseTopic: packet.properties?.responseTopic,
            correlationData: packet.properties?.correlationData,
          },
        );
        if (qos === 1 && packet.messageId !== undefined) {
          this.send({
            cmd: "puback",
            messageId: packet.messageId,
            ...(this.protocolVersion === 5 ? { reasonCode: 0 } : {}),
          } as Packet);
        }
        return;
      }
      case "subscribe": {
        const granted: number[] = [];
        const id = packet.properties?.subscriptionIdentifier;
        for (const subscription of packet.subscriptions) {
          const qos: MqttQoS = subscription.qos >= 1 ? 1 : 0;
          granted.push(qos);
          await this.server.memoryBroker.subscribe(
            this,
            subscription.topic,
            qos,
            typeof id === "number" ? id : undefined,
          );
        }
        this.send({
          cmd: "suback",
          messageId: packet.messageId,
          granted,
        } as Packet);
        return;
      }
      case "unsubscribe":
        for (const filter of packet.unsubscriptions) {
          this.server.memoryBroker.unsubscribe(this, filter);
        }
        this.send({
          cmd: "unsuback",
          messageId: packet.messageId,
          ...(this.protocolVersion === 5
            ? { granted: packet.unsubscriptions.map(() => 0) }
            : {}),
        } as Packet);
        return;
      case "pingreq":
        this.send({ cmd: "pingresp" });
        return;
      case "disconnect":
        this.closed = true;
        clearTimeout(this.keepaliveTimer);
        this.connected = false;
        this.server.release(this.clientId, this);
        this.server.memoryBroker.disconnect(this);
        this.socket.end();
        return;
      default:
        // puback and the rest: nothing to do.
        return;
    }
  }

  protected async onConnect(packet: IConnectPacket): Promise<void> {
    if (this.connected) {
      await this.drop();
      return;
    }
    this.protocolVersion = (packet.protocolVersion ?? 4) as 3 | 4 | 5;
    if (!(await this.server.authenticate(packet))) {
      this.send(
        this.protocolVersion === 5
          ? ({
              cmd: "connack",
              reasonCode: 135,
              sessionPresent: false,
            } as Packet)
          : ({
              cmd: "connack",
              returnCode: 5,
              sessionPresent: false,
            } as Packet),
      );
      this.closed = true;
      this.socket.end();
      return;
    }
    this.clientId =
      packet.clientId || `memory-${Math.random().toString(36).slice(2, 10)}`;
    this.willMessage = packet.will
      ? {
          topic: packet.will.topic,
          payload: new Uint8Array(
            typeof packet.will.payload === "string"
              ? Buffer.from(packet.will.payload)
              : packet.will.payload,
          ),
          qos: (packet.will.qos ?? 0) >= 1 ? 1 : 0,
          retain: packet.will.retain ?? false,
        }
      : undefined;
    await this.server.claim(this.clientId, this);
    this.server.memoryBroker.connect(this);
    this.connected = true;
    this.keepaliveMs = (packet.keepalive ?? 0) * 1500;
    this.touch();
    this.send(
      this.protocolVersion === 5
        ? ({ cmd: "connack", reasonCode: 0, sessionPresent: false } as Packet)
        : ({ cmd: "connack", returnCode: 0, sessionPresent: false } as Packet),
    );
  }

  protected touch(): void {
    if (!this.keepaliveMs) {
      return;
    }
    clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => void this.drop(), this.keepaliveMs);
    this.keepaliveTimer.unref?.();
  }

  protected send(packet: Packet): void {
    if (this.socket.destroyed) {
      return;
    }
    this.socket.write(
      mqttPacket.generate(packet, { protocolVersion: this.protocolVersion }),
    );
  }

  protected messageId(): number {
    const id = this.nextId;
    this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1;
    return id;
  }
}
