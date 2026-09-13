import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createCipheriv, createDiffieHellman, hkdfSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  Message,
  type MessageBus,
  sessionBus,
  Variant,
} from "@jellybrick/dbus-next";
import { readLinuxPassword } from "./linux.ts";

const available = process.platform === "linux" &&
  spawnSync("dbus-daemon", ["--version"]).status === 0;

describe("Secret Service password lookup", { skip: !available }, () => {
  if (!available) return;
  let address: string;
  let service: MessageBus;
  let stop: () => Promise<void>;
  let respond: (request: Message) => Message;

  before(async () => {
    const daemon = await startBus();
    address = daemon.address;
    service = sessionBus({ busAddress: address });
    stop = async () => {
      service.disconnect();
      await daemon.stop();
    };
    await once(service, "connect");
    await service.requestName("org.freedesktop.secrets", 0);
    service.addMethodHandler((request) => {
      service.send(respond(request));
      return true;
    });
  });

  after(async () => await stop?.());

  const read = () =>
    readLinuxPassword(
      "example.test",
      "alice",
      sessionBus({ busAddress: address }),
    );

  it("should report absence only after a successful empty search", async () => {
    respond = (request) => {
      assert.equal(request.member, "SearchItems");
      assert.deepEqual(request.body, [{
        service: "example.test",
        username: "alice",
      }]);
      return Message.newMethodReturn(request, "aoao", [[], []]);
    };

    assert.equal(await read(), undefined);
  });

  it("should preserve the store's access error", async () => {
    respond = (request) =>
      Message.newError(
        request,
        "org.freedesktop.DBus.Error.AccessDenied",
        "Access denied by the test store.",
      );

    await assert.rejects(read(), {
      type: "org.freedesktop.DBus.Error.AccessDenied",
      text: "Access denied by the test store.",
    });
  });

  it("should reject a locked matching credential without reading it", async () => {
    respond = (request) => {
      assert.equal(request.member, "SearchItems");
      return Message.newMethodReturn(request, "aoao", [[], ["/item/locked"]]);
    };

    await assert.rejects(read(), {
      type: "org.freedesktop.Secret.Error.IsLocked",
    });
  });

  it("should reject ambiguous matches across locked and unlocked items", async () => {
    respond = (request) => {
      assert.equal(request.member, "SearchItems");
      return Message.newMethodReturn(request, "aoao", [["/item/one"], [
        "/item/two",
      ]]);
    };

    await assert.rejects(read(), {
      message: "More than one credential matches the service and username.",
    });
  });

  it("should reject a failed session negotiation", async () => {
    respond = (request) =>
      request.member === "SearchItems"
        ? Message.newMethodReturn(request, "aoao", [["/item/one"], []])
        : Message.newError(
          request,
          "org.freedesktop.DBus.Error.Failed",
          "Session failed.",
        );

    await assert.rejects(read(), {
      type: "org.freedesktop.DBus.Error.Failed",
      text: "Session failed.",
    });
  });

  for (
    const password of ["", "비밀번호\nwith spaces\u0000", "\ufeffpassword"]
  ) {
    it(`should read an encrypted ${password === "" ? "empty" : "Unicode"} password without altering it`, async () => {
      respond = encryptedStore(Buffer.from(password, "utf8"));

      assert.equal(await read(), password);
    });
  }

  it("should reject malformed password encoding", async () => {
    respond = encryptedStore(Buffer.from([0xff]));

    await assert.rejects(read(), TypeError);
  });

  it("should preserve a lookup error after the search succeeds", async () => {
    const normal = encryptedStore(Buffer.from("unused"));
    respond = (request) =>
      request.member === "GetSecret"
        ? Message.newError(
          request,
          "org.freedesktop.Secret.Error.IsLocked",
          "Locked during lookup.",
        )
        : normal(request);

    await assert.rejects(read(), {
      type: "org.freedesktop.Secret.Error.IsLocked",
      text: "Locked during lookup.",
    });
  });
});

// Helpers

function encryptedStore(password: Buffer): (request: Message) => Message {
  let key: Buffer;
  return (request) => {
    if (request.member === "SearchItems") {
      return Message.newMethodReturn(request, "aoao", [["/item/one"], []]);
    }
    if (request.member === "OpenSession") {
      assert.equal(request.body[0], "dh-ietf1024-sha256-aes128-cbc-pkcs7");
      const input = request.body[1];
      assert.ok(input instanceof Variant);
      assert.equal(input.signature, "ay");
      assert.ok(input.value instanceof Uint8Array);
      const dh = createDiffieHellman(
        Buffer.from(
          "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
            "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
            "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
            "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
            "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381" +
            "FFFFFFFFFFFFFFFF",
          "hex",
        ),
        2,
      );
      const publicKey = dh.generateKeys();
      key = Buffer.from(
        hkdfSync("sha256", dh.computeSecret(input.value), "", "", 16),
      );
      return Message.newMethodReturn(request, "vo", [
        new Variant("ay", publicKey),
        "/session/one",
      ]);
    }
    assert.equal(request.member, "GetSecret");
    assert.equal(request.path, "/item/one");
    assert.deepEqual(request.body, ["/session/one"]);
    const iv = Buffer.alloc(16, 1);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(password), cipher.final()]);
    return Message.newMethodReturn(request, "(oayays)", [[
      "/session/one",
      iv,
      encrypted,
      "text/plain; charset=utf-8",
    ]]);
  };
}

async function startBus(): Promise<{
  readonly address: string;
  readonly stop: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "optique-keyring-"));
  const child = spawn("dbus-daemon", [
    "--session",
    "--nofork",
    "--nopidfile",
    "--print-address=1",
    `--address=unix:path=${join(directory, "bus")}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  const stop = async () => {
    child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.once("error", reject);
      child.once(
        "exit",
        () => reject(new Error("The test D-Bus daemon exited.")),
      );
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
        const newline = output.indexOf("\n");
        if (newline >= 0) resolve(output.slice(0, newline));
      });
    });
    return { address, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
