import express from "express";
import cors from "cors";
import { hourlyLimiter } from "./rateLimit";
import router from "./routes/review";

import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(hourlyLimiter);
app.use("/api", router);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));