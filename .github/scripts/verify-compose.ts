/// <reference types="bun" />

import { join } from "node:path";

export {};

type ComposePort = {
  host_ip?: string;
  protocol?: string;
  target?: number;
  published?: string;
};

type ComposeVolume = {
  source?: string;
  target?: string;
  type?: string;
};

type ComposeService = {
  cap_add?: string[];
  depends_on?: Record<string, { condition?: string }>;
  devices?: Array<{ source?: string; target?: string }>;
  environment?: Record<string, string>;
  healthcheck?: unknown;
  image?: string;
  init?: boolean;
  network_mode?: string;
  networks?: Record<string, unknown>;
  ports?: ComposePort[];
  security_opt?: string[];
  tmpfs?: string[];
  user?: string;
  volumes?: ComposeVolume[];
};

type ComposeProject = {
  services?: Record<string, ComposeService>;
};

const base = await composeConfig(["compose.yml"]);
const vpn = await composeConfig(["compose.yml", "compose.gluetun.yml"]);

await assertBunPin();

const bobarr = service(base, "bobarr");
const jackett = service(base, "jackett");
const flaresolverr = service(base, "flaresolverr");
const transmission = service(base, "transmission");

assert(
  bobarr.image === "bobarr-v2:0.1.0",
  "Bobarr must use an explicit application version",
);
assert(bobarr.init === true, "Bobarr must use an init process");
assertNonRoot(bobarr, "Bobarr");
assertLinuxServerUserMapping(jackett, "Jackett");
assertLinuxServerUserMapping(transmission, "Transmission");
assertNoNewPrivileges(bobarr, "Bobarr");
assertNoNewPrivileges(jackett, "Jackett");
assertNoNewPrivileges(flaresolverr, "FlareSolverr");
assertNoNewPrivileges(transmission, "Transmission");

assertTaggedDigest(
  jackett,
  "lscr.io/linuxserver/jackett:v0.24.2251-ls468@sha256:",
  "Jackett",
);
assertTaggedDigest(
  flaresolverr,
  "ghcr.io/flaresolverr/flaresolverr:v3.5.0@sha256:",
  "FlareSolverr",
);
assertTaggedDigest(
  transmission,
  "lscr.io/linuxserver/transmission:4.1.3-r0-ls355@sha256:",
  "Transmission",
);

for (const [name, value] of Object.entries({
  bobarr,
  jackett,
  flaresolverr,
  transmission,
})) {
  assert(value.healthcheck !== undefined, `${name} must have a health check`);
}

const bobarrPort = onlyPort(bobarr, "Bobarr");
const expectedBobarrBindAddress =
  process.env["BOBARR_BIND_ADDRESS"] ?? "0.0.0.0";
assert(
  bobarrPort.target === 3000 &&
    bobarrPort.host_ip === expectedBobarrBindAddress,
  "Bobarr's HTTP port must use the configured bind address",
);
const jackettPort = onlyPort(jackett, "Jackett");
const expectedJackettBindAddress =
  process.env["JACKETT_BIND_ADDRESS"] ?? "0.0.0.0";
assert(
  jackettPort.target === 9117 &&
    jackettPort.host_ip === expectedJackettBindAddress,
  "Jackett's setup UI must use the configured bind address",
);
assertNoPublishedPorts(flaresolverr, "FlareSolverr");
const expectedTransmissionBindAddress =
  process.env["TRANSMISSION_BIND_ADDRESS"] ?? "0.0.0.0";
assertConfiguredPort(
  transmission,
  9091,
  expectedTransmissionBindAddress,
  "Transmission",
);
const expectedTransmissionPeerBindAddress =
  process.env["TRANSMISSION_PEER_BIND_ADDRESS"] ?? "0.0.0.0";
const expectedTransmissionPeerPort = Number(
  process.env["TRANSMISSION_PEER_PORT"] ?? "51413",
);
assertConfiguredPort(
  transmission,
  expectedTransmissionPeerPort,
  expectedTransmissionPeerBindAddress,
  "Transmission peer TCP",
  "tcp",
);
assertConfiguredPort(
  transmission,
  expectedTransmissionPeerPort,
  expectedTransmissionPeerBindAddress,
  "Transmission peer UDP",
  "udp",
);
assert(
  transmission.environment?.["PEERPORT"] ===
    String(expectedTransmissionPeerPort),
  "Transmission must listen on the published peer port",
);
assert(
  Boolean(transmission.environment?.["USER"]) &&
    Boolean(transmission.environment?.["PASS"]),
  "Transmission diagnostics and RPC must remain authenticated",
);

assert(
  bobarr.depends_on?.["jackett"]?.condition === "service_started" &&
    bobarr.depends_on?.["transmission"]?.condition === "service_started",
  "Bobarr must start alongside connectors so its degraded UI remains available",
);
assert(
  bobarr.environment?.["BOBARR_COOKIE_SECURE"] ===
    (process.env["BOBARR_COOKIE_SECURE"] ?? "false"),
  "Bobarr's session cookie policy must match its HTTP or HTTPS deployment",
);
assert(
  bobarr.environment?.["BOBARR_JACKETT_URL"] === undefined &&
    bobarr.environment?.["BOBARR_TRANSMISSION_URL"] === undefined,
  "Base Compose connector URLs must remain configurable through Settings",
);

const bobarrMedia = volumeAt(bobarr, "/media");
const transmissionDownloads = volumeAt(transmission, "/media/downloads");
const linuxServerDownloads = volumeAt(transmission, "/downloads");
assert(
  transmissionDownloads.source === linuxServerDownloads.source &&
    transmissionDownloads.source ===
      join(bobarrMedia.source ?? "", "downloads"),
  "Transmission download aliases must use Bobarr's shared media tree",
);
assert(
  volumeAt(bobarr, "/config").type === "bind" &&
    volumeAt(transmission, "/config").type === "bind",
  "Application and Transmission state must use persistent config mounts",
);

const vpnBobarr = service(vpn, "bobarr");
const vpnGluetun = service(vpn, "gluetun");
const vpnTransmission = service(vpn, "transmission");

assertTaggedDigest(vpnGluetun, "qmcgaw/gluetun:v3.40.0@sha256:", "Gluetun");
assertNoNewPrivileges(vpnGluetun, "Gluetun");
assertConfiguredPort(
  vpnGluetun,
  9091,
  expectedTransmissionBindAddress,
  "VPN Transmission diagnostics",
);
assertNoPublishedPorts(vpnTransmission, "VPN Transmission");
assert(
  vpnTransmission.network_mode === "service:gluetun",
  "VPN Transmission must share Gluetun's network namespace",
);
assert(
  Object.keys(vpnTransmission.networks ?? {}).length === 0,
  "VPN Transmission must not retain a direct application network",
);
assert(
  vpnTransmission.depends_on?.["gluetun"]?.condition === "service_healthy",
  "VPN Transmission must wait for Gluetun health",
);
assert(
  vpnBobarr.environment?.["BOBARR_TRANSMISSION_URL"] ===
    "http://gluetun:9091/transmission/rpc",
  "Bobarr must reach VPN-routed Transmission through Gluetun",
);
assert(
  vpnGluetun.cap_add?.includes("NET_ADMIN") === true &&
    vpnGluetun.devices?.some(
      (device) =>
        device.source === "/dev/net/tun" && device.target === "/dev/net/tun",
    ) === true,
  "Gluetun must have the tunnel device and network capability it needs",
);
assert(
  vpnGluetun.environment?.["FIREWALL"] === "on" &&
    vpnGluetun.environment?.["FIREWALL_INPUT_PORTS"] === "9091",
  "Gluetun's fail-closed firewall must stay enabled with private RPC ingress",
);

// oxlint-disable-next-line no-console -- CI should emit a concise success marker.
console.log("Base and Gluetun Compose security contracts are valid.");

async function assertBunPin(): Promise<void> {
  const [dockerfile, packageText, ci, release] = await Promise.all([
    Bun.file("Dockerfile").text(),
    Bun.file("package.json").text(),
    Bun.file(".github/workflows/ci.yml").text(),
    Bun.file(".github/workflows/release.yml").text(),
  ]);
  const packageJson = JSON.parse(packageText) as {
    engines?: { bun?: string };
    packageManager?: string;
  };
  assert(
    packageJson.packageManager === "bun@1.4.0" &&
      packageJson.engines?.bun === "1.4.0",
    "package.json must pin Bun 1.4.0 consistently",
  );
  assert(
    dockerfile.match(/oven\/bun:1\.4\.0-alpine@sha256:[a-f\d]{64}/g)?.length ===
      2,
    "Every Bun Docker stage must use the same versioned immutable image",
  );
  for (const [name, workflow] of Object.entries({ ci, release })) {
    assert(
      workflow.includes(
        "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      ) && workflow.includes("bun-version: 1.4.0"),
      `${name} workflow must pin setup-bun and Bun 1.4.0`,
    );
  }
}

async function composeConfig(files: string[]): Promise<ComposeProject> {
  const arguments_ = ["compose"];
  for (const file of files) arguments_.push("-f", file);
  arguments_.push("config", "--format", "json");
  const child = Bun.spawn(["docker", ...arguments_], {
    env: {
      ...process.env,
      TRANSMISSION_PASSWORD:
        process.env["TRANSMISSION_PASSWORD"] ?? "compose-contract-only",
      VPN_SERVICE_PROVIDER: process.env["VPN_SERVICE_PROVIDER"] ?? "custom",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `docker compose config failed (${exitCode}): ${stderr.trim()}`,
    );
  }
  return JSON.parse(stdout) as ComposeProject;
}

function service(project: ComposeProject, name: string): ComposeService {
  const value = project.services?.[name];
  if (!value) throw new Error(`Compose service ${name} is missing`);
  return value;
}

function assertNonRoot(value: ComposeService, name: string): void {
  assert(
    value.user !== undefined && !value.user.startsWith("0:"),
    `${name} must run with an explicit non-root user`,
  );
}

function assertNoNewPrivileges(value: ComposeService, name: string): void {
  assert(
    value.security_opt?.includes("no-new-privileges:true") === true,
    `${name} must prevent privilege escalation`,
  );
}

function assertLinuxServerUserMapping(
  value: ComposeService,
  name: string,
): void {
  assert(
    value.user === undefined &&
      /^\d+$/.test(value.environment?.["PUID"] ?? "") &&
      /^\d+$/.test(value.environment?.["PGID"] ?? ""),
    `${name} must let LinuxServer init apply its PUID/PGID mapping`,
  );
}

function assertTaggedDigest(
  value: ComposeService,
  prefix: string,
  name: string,
): void {
  assert(
    value.image?.startsWith(prefix) === true &&
      /@sha256:[a-f\d]{64}$/.test(value.image),
    `${name} must be pinned by an explicit version and immutable digest`,
  );
}

function assertNoPublishedPorts(value: ComposeService, name: string): void {
  assert(
    (value.ports?.length ?? 0) === 0,
    `${name} must not publish host ports`,
  );
}

function onlyPort(value: ComposeService, name: string): ComposePort {
  assert(value.ports?.length === 1, `${name} must publish exactly one port`);
  return value.ports[0] as ComposePort;
}

function assertConfiguredPort(
  value: ComposeService,
  target: number,
  bindAddress: string,
  name: string,
  protocol = "tcp",
): void {
  const port = value.ports?.find(
    (candidate) =>
      candidate.target === target && (candidate.protocol ?? "tcp") === protocol,
  );
  assert(
    port?.host_ip === bindAddress && port.published === String(target),
    `${name} must publish ${target}/${protocol} on ${bindAddress}`,
  );
}

function volumeAt(value: ComposeService, target: string): ComposeVolume {
  const volume = value.volumes?.find(
    (candidate) => candidate.target === target,
  );
  if (!volume) throw new Error(`Required ${target} volume is missing`);
  return volume;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
