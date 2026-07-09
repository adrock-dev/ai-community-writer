import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AcademyResearchController } from "./academy-research.controller.js";
import { PublicController } from "./public.controller.js";
import { DbService } from "./db.service.js";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { AcademyResearchService } from "./academy-research.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";
import { SlotService } from "./slot.service.js";
import { WorkerService } from "./worker.service.js";
import { ImageGenerationService } from "./image-generation.service.js";

@Module({
  controllers: [AdminController, AcademyResearchController, PublicController],
  providers: [DbService, AcademyResearchDbService, AcademyResearchService, DrivingplusApiService, SlotService, WorkerService, ImageGenerationService],
})
export class AppModule {}
