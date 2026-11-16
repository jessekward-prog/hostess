const { execFile } = require('child_process');
const net = require('net');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(takenPorts = new Set(), start = 4000, end = 4999) {
  for (let port = start; port <= end; port++) {
    if (takenPorts.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${end}`);
}

async function containerExists(name) {
  const out = await run(['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}']);
  return out.split('\n').includes(name);
}

async function containerStatus(name) {
  if (!(await containerExists(name))) return 'absent';
  const out = await run(['inspect', '-f', '{{.State.Status}}', name]);
  return out; // running, exited, created, ...
}

async function stopAndRemove(name) {
  if (await containerExists(name)) {
    await run(['rm', '-f', name]);
  }
}

// Registry pulls occasionally time out mid-build (Docker Desktop networking
// hiccup, VPN interference, brief DNS blip) — retrying the same build is safe
// since it's just re-running the same docker build, and clears most of these
// without the operator having to manually redeploy.
const TRANSIENT_BUILD_ERROR = /deadlineexceeded|context deadline exceeded|i\/o timeout|TLS handshake timeout|connection reset|temporary failure in name resolution/i;

// A failed BuildKit run prints the whole progress log; the cause is in the last lines (the failing step,
// its error, the Dockerfile line). Surface those, and keep the full log in the server log.
const BUILD_TAIL_LINES = 25;
function buildFailure(err) {
  const lines = err.message.split('\n').filter((l) => l.trim());
  console.error(`[docker build failed]\n${err.message}`);
  if (lines.length <= BUILD_TAIL_LINES) return err;
  return new Error(`Docker build failed. Last ${BUILD_TAIL_LINES} lines of the build log:\n${lines.slice(-BUILD_TAIL_LINES).join('\n')}`);
}

async function buildImage(tag, contextDir) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run(['build', '-t', tag, contextDir]);
      return;
    } catch (err) {
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !TRANSIENT_BUILD_ERROR.test(err.message)) throw buildFailure(err);
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
}

async function ensureNetwork(networkName) {
  const out = await run(['network', 'ls', '--filter', `name=^${networkName}$`, '--format', '{{.Name}}']);
  if (!out.split('\n').includes(networkName)) {
    await run(['network', 'create', networkName]);
  }
}

async function runContainer({ name, image, network, hostPort, containerPort, gatewayHostPort, gatewayContainerPort, gatewayDir, env = {}, dataDir, dataVolume }) {
  const args = ['run', '-d', '--name', name, '--restart', 'unless-stopped'];
  if (network) args.push('--network', network);
  // Docker Desktop (macOS, Windows) resolves this name by itself; Linux needs it mapped. With
  // it, containerUrl() below works the same on all three.
  args.push('--add-host', 'host.docker.internal:host-gateway');
  if (hostPort && containerPort) {
    args.push('-p', `127.0.0.1:${hostPort}:${containerPort}`);
  }
  if (gatewayHostPort && gatewayContainerPort) {
    args.push('-p', `127.0.0.1:${gatewayHostPort}:${gatewayContainerPort}`);
  }
  // Read-only handoff for "what's my current public gateway URL" — Hostess
  // (on the host) writes it here whenever the tunnel starts/stops/regenerates,
  // the app just reads the file. No new network surface, no dashboard API
  // reachable from inside a container, no docker-bridge exposure question.
  if (gatewayDir) {
    args.push('-v', `${gatewayDir}:/run/hostess-gateway:ro`);
  }
  if (dataDir) {
    args.push('-v', `${dataVolume}:${dataDir}`);
  }
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }
  args.push(image);
  await run(args);
}

// Inside a container "localhost" is the container, so an address the operator typed for a
// server on this machine (LM Studio on http://localhost:1234) has to point at the host instead.
function containerUrl(url) {
  return String(url).replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i, '$1host.docker.internal');
}

// A container can sit on more than one network, but `docker run` only accepts
// one --network, so any extra has to be attached after the fact.
async function connectNetwork(networkName, containerName) {
  try {
    await run(['network', 'connect', networkName, containerName]);
  } catch (err) {
    if (!/already exists|already connected/i.test(err.message)) throw err;
  }
}

async function logs(name, tailLines = 200) {
  return run(['logs', '--tail', String(tailLines), name]);
}

module.exports = {
  run,
  findFreePort,
  containerExists,
  containerStatus,
  stopAndRemove,
  buildFailure,
  buildImage,
  ensureNetwork,
  runContainer,
  containerUrl,
  connectNetwork,
  logs,
};
