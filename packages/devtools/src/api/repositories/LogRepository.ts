import { Repository } from "alepha/orm";
import { logs } from "../entities/logs.ts";
import { DevToolsDatabaseProvider } from "../providers/DevToolsDatabaseProvider.ts";

export class LogRepository extends Repository.of(
  logs,
  DevToolsDatabaseProvider,
) {}
