import { httpRouter } from "convex/server";
import type { CreateAuth } from "@convex-dev/better-auth";
import { authComponent, createAuth } from "./auth";
import type { DataModel } from "./_generated/dataModel";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth as CreateAuth<DataModel>);

export default http;
