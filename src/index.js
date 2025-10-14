require("dotenv").config();
const http = require("http");
const app = require("./app");

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT, (error) => {
  if (error) {
    console.error("Error iniciando el servidor:", error);
    process.exit(1);
  }

  console.log(`✅ Back en http://localhost:${PORT}`);
});

