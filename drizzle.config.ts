import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Drizzle Kit doesn't auto-load .env.local — pick it up explicitly so
// `pnpm db:generate` / `db:migrate` / `db:studio` work without inline env.
// (Same pattern as the landing project.)
config({ path: ".env.local" });

/**
 * Drizzle Kit config for the Wend APP tables (shared Neon DB with the landing).
 * The landing owns `waitlist_signups`; this config only manages the app schema
 * in src/db/schema.ts. `tablesFilter` keeps generate/migrate from ever touching
 * the landing's table even though they share one database.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Never manage the landing's table from here.
  tablesFilter: ["!waitlist_signups"],
  strict: true,
  verbose: true,
});
