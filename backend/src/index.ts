import "dotenv/config";
import express from "express";
import { jobsRouter } from "./routes/jobs";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/jobs", jobsRouter);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
