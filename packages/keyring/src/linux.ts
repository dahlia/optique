import { Buffer } from "node:buffer";
import { createDecipheriv, createDiffieHellman, hkdfSync } from "node:crypto";
import type { EventEmitter } from "node:events";
import { clearTimeout, setTimeout } from "node:timers";
import {
  DBusError,
  Message,
  type MessageBus,
  sessionBus,
  Variant,
} from "@jellybrick/dbus-next";

const destination = "org.freedesktop.secrets";
const servicePath = "/org/freedesktop/secrets";
const serviceInterface = "org.freedesktop.Secret.Service";

const algorithm = "dh-ietf1024-sha256-aes128-cbc-pkcs7";

// RFC 2409, section 6.2. Bun does not expose this group as "modp2".
const prime = Buffer.from(
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381" +
    "FFFFFFFFFFFFFFFF",
  "hex",
);

/**
 * Reads one matching Secret Service item without selecting another store.
 * @param service Service attribute of the credential.
 * @param username Username attribute of the credential.
 * @param bus Connection owned and closed by this lookup.
 * @returns The password, or undefined after a successful search with no match.
 * @throws If the service is inaccessible, the item is locked or ambiguous,
 * or the session or password cannot be read.
 * @internal
 */
export async function readLinuxPassword(
  service: string,
  username: string,
  bus: MessageBus = sessionBus(),
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = new Promise<never>((_, reject) => {
    // Connection errors are events, rather than rejections of bus.call().
    // The library's event map omits the error event it emits at runtime.
    const events: EventEmitter = bus;
    events.on("error", (error: unknown) => reject(error));

    timer = setTimeout(() => {
      reject(
        new DOMException(
          "The Secret Service password lookup timed out.",
          "TimeoutError",
        ),
      );
    }, 30_000);
  });

  try {
    return await Promise.race([
      readPassword(bus, service, username),
      unavailable,
    ]);
  } finally {
    clearTimeout(timer);

    // Closing this connection also closes its Secret Service session.
    bus.disconnect();
  }
}

async function call(
  bus: MessageBus,
  path: string,
  iface: string,
  member: string,
  signature: string,
  body: readonly unknown[],
  replySignature: string,
): Promise<readonly unknown[]> {
  const reply = await bus.call(
    new Message({
      destination,
      path,
      interface: iface,
      member,
      signature,
      body: [...body],
    }),
  );
  if (reply == null || reply.signature !== replySignature) {
    throw new TypeError("The Secret Service returned an invalid response.");
  }

  return reply.body;
}

async function readPassword(
  bus: MessageBus,
  service: string,
  username: string,
): Promise<string | undefined> {
  const [unlocked, locked] = await call(
    bus,
    servicePath,
    serviceInterface,
    "SearchItems",
    "a{ss}",
    [{ service, username }],
    "aoao",
  );
  if (!isPaths(unlocked) || !isPaths(locked)) {
    throw new TypeError("The Secret Service returned invalid search results.");
  }

  const paths = [...new Set([...unlocked, ...locked])];
  if (paths.length === 0) return undefined;
  if (paths.length > 1) {
    throw new Error(
      "More than one credential matches the service and username.",
    );
  }
  if (locked.length > 0) {
    throw new DBusError(
      "org.freedesktop.Secret.Error.IsLocked",
      "The matching Secret Service credential is locked.",
    );
  }

  // Use the Secret Service's specified encrypted session algorithm, as the
  // native backend does. A negotiation failure remains a lookup error.
  const dh = createDiffieHellman(prime, 2);
  const [output, session] = await call(
    bus,
    servicePath,
    serviceInterface,
    "OpenSession",
    "sv",
    [algorithm, new Variant("ay", dh.generateKeys())],
    "vo",
  );
  if (
    !(output instanceof Variant) || output.signature !== "ay" ||
    !isBytes(output.value) || typeof session !== "string" || session === "/"
  ) {
    throw new TypeError("The Secret Service returned an invalid session.");
  }
  const key = Buffer.from(
    hkdfSync("sha256", dh.computeSecret(output.value), "", "", 16),
  );

  const [secret] = await call(
    bus,
    paths[0],
    "org.freedesktop.Secret.Item",
    "GetSecret",
    "o",
    [session],
    "(oayays)",
  );
  if (
    !Array.isArray(secret) || secret.length !== 4 || secret[0] !== session ||
    !isBytes(secret[1]) || secret[1].length !== 16 || !isBytes(secret[2]) ||
    typeof secret[3] !== "string"
  ) {
    throw new TypeError("The Secret Service returned an invalid secret.");
  }

  const decipher = createDecipheriv("aes-128-cbc", key, secret[1]);
  const password = Buffer.concat([
    decipher.update(secret[2]),
    decipher.final(),
  ]);

  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    password,
  );
}

function isPaths(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}
