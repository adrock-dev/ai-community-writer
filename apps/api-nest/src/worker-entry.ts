import "reflect-metadata";
import { DbService } from "./db.service.js";
import { ImageGenerationService } from "./image-generation.service.js";
import { WorkerService } from "./worker.service.js";

const db = new DbService();
db.init();
const worker = new WorkerService(db, new ImageGenerationService());
worker.startLoop();
