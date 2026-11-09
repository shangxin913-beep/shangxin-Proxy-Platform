import { Buffer } from "node:buffer";
import type { Exit } from "../drizzle/schema";

function nodeName(exit: Exit) {
  const area = exit.observedCountry || exit.expectedCountry || "地区待验证";
  const city = exit.observedCity || exit.expectedCity;
  return city ? `${area} · ${city} · ${exit.displayName}` : `${area} · ${exit.displayName}`;
}

function vlessLink(exit: Exit) {
  const params = new URLSearchParams({
    encryption: "none",
    security: exit.entrySecurity.toLowerCase(),
    type: "tcp",
    sni: exit.entryHost,
  });
  return `vless://${exit.entryUuid}@${exit.entryHost}:${exit.entryPort}?${params.toString()}#${encodeURIComponent(nodeName(exit))}`;
}

export function makeSubscription(exits: Exit[]) {
  const now = Date.now();
  const active = exits.filter((exit) => exit.enabled && exit.subscribeEnabled && exit.status === "passed" && (!exit.expiresAt || exit.expiresAt.getTime() > now));
  const vless = active.map(vlessLink);
  const base64 = Buffer.from(vless.join("\n"), "utf8").toString("base64");
  const clash = {
    proxies: active.map((exit) => ({
      name: nodeName(exit),
      type: "vless",
      server: exit.entryHost,
      port: exit.entryPort,
      uuid: exit.entryUuid,
      tls: true,
      servername: exit.entryHost,
      network: "tcp",
      udp: false,
      "skip-cert-verify": false,
    })),
    "proxy-groups": [{ name: "ExitPanel", type: "select", proxies: active.map(nodeName) }],
    rules: ["MATCH,ExitPanel"],
  };
  return { activeCount: active.length, vless, base64, clash };
}
