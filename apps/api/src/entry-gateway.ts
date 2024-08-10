import { createServer } from "http";
import { createGateway } from "./gateway/index.js";
import { startBackgroundJobs } from "./jobs/index.js";

const PORT = parseInt(process.env.GATEWAY_PORT || "4002");

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "gateway", pod: process.env.HOSTNAME }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = createGateway(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gateway service listening on port ${PORT}`);
});

// Background jobs run on gateway (leader election handles multi-replica)
startBackgroundJobs();
