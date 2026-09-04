const net = require("node:net");

const server = net.createServer();

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = address.port;
  const token = "probrou-test-token";

  console.log("Test WebSocket port:", port);
  console.log("Connecting to Diffusion Studio pipe...");

  const pipe = net.createConnection("\\\\.\\pipe\\diffusion-studio");

  pipe.setEncoding("utf8");

  pipe.on("connect", () => {
    console.log("PIPE CONNECTED");

    pipe.end(JSON.stringify({
      port,
      token
    }));
  });

  pipe.on("data", (data) => {
    console.log("PIPE DATA:", JSON.stringify(data));
  });

  pipe.on("end", () => {
    console.log("PIPE END");
    server.close();
  });

  pipe.on("close", () => {
    console.log("PIPE CLOSED");
    server.close();
  });

  pipe.on("error", (err) => {
    console.log("PIPE ERROR:", err.message);
    server.close();
  });
});
