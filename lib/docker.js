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
    await run(['rm', '-f', name]).catch(() => {});
  }
}

async function buildImage(tag, contextDir) {
  await run(['build', '-t', tag, contextDir]);
}

async function ensureNetwork(networkName) {
  const out = await run(['network', 'ls', '--filter', `name=^${networkName}$`, '--format', '{{.Name}}']);
  if (!out.split('\n').includes(networkName)) {
    await run(['network', 'create', networkName]);
  }
}

async function runContainer({ name, image, network, hostPort, containerPort, env = {} }) {
  const args = ['run', '-d', '--name', name, '--restart', 'unless-stopped'];
  if (network) args.push('--network', network);
  if (hostPort && containerPort) {
    args.push('-p', `127.0.0.1:${hostPort}:${containerPort}`);
  }
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }
  args.push(image);
  await run(args);
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
  buildImage,
  ensureNetwork,
  runContainer,
  logs,
};
