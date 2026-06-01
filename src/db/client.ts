/**
 * Wend app — server-side Drizzle client (Neon HTTP driver).
 *
 * SERVER-ONLY. This must never be imported from React Native/client code — it
 * reads DATABASE_URL and opens a DB connection. It exists in the app repo so
 * the schema, migrations, and Better Auth config live in one place; the actual
 * backend (the auth handler + future API routes) imports this.
 *
 * Mirrors the landing's lazy pattern: importing the module touches no env, so
 * tooling/bundling won't fail when DATABASE_URL is unset.
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;
