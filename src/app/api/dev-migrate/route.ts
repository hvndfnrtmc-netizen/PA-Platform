// TEMPORARY one-off migration endpoint (Plan B: run migration from Vercel
// because the user's local network blocks port 5432 to Neon).
//
// Security: requires ?key=<ADMIN_PASSWORD> matching the env var. The ADMIN
// password is only known to the project owner. Remove this route after
// migration completes.
//
// Usage (browser): GET https://<vercel-url>/api/dev-migrate?key=<ADMIN_PASSWORD>
import { NextResponse } from "next/server";
import { Client } from "pg";
import { MIGRATION_SQL } from "./sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const expected = process.env.ADMIN_PASSWORD ?? "";

  if (!expected || key !== expected) {
    return NextResponse.json(
      { ok: false, error: "forbidden: key mismatch (must equal ADMIN_PASSWORD)" },
      { status: 403 },
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Execute the whole dump (DDL + INSERTs) as one implicit transaction.
    await client.query(MIGRATION_SQL);

    // Verify: count rows in a few key tables.
    const counts: Record<string, number> = {};
    for (const table of ["users", "system_configs", "module_permissions"]) {
      try {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS n FROM ${table}`,
        );
        counts[table] = rows[0]?.n ?? -1;
      } catch {
        counts[table] = -1;
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Migration complete. Remember to remove /api/dev-migrate route.",
      counts,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
