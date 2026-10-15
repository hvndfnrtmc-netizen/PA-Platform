// One-off: create the 5 storage buckets required by PA-Platform on Supabase.
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.supabase (not committed).
// Idempotent: skips buckets that already exist.

import "dotenv/config";

const BUCKETS = [
  { name: "reception-files",    public: true }, // 会议接待照片
  { name: "party-materials",    public: true }, // 党员关系转接材料
  { name: "awards-proofs",      public: true }, // 荣誉资质证明附件
  { name: "major-project-files", public: true }, // 重大项目附件
  { name: "odc-avatars",        public: true }, // 头像
];

async function main() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // 1. List existing buckets
  const listRes = await fetch(`${url}/storage/v1/bucket`, { headers });
  if (!listRes.ok) {
    console.error(`List buckets failed: HTTP ${listRes.status}`);
    console.error(await listRes.text());
    process.exit(1);
  }
  const existing = (await listRes.json()) as Array<{ name: string }>;
  console.log(`> Existing buckets: ${existing.map((b) => b.name).join(", ") || "(none)"}`);

  // 2. Create missing buckets
  for (const bucket of BUCKETS) {
    if (existing.some((b) => b.name === bucket.name)) {
      console.log(`= ${bucket.name}: already exists, skip`);
      continue;
    }
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers,
      body: JSON.stringify(bucket),
    });
    if (res.ok) {
      console.log(`+ ${bucket.name}: created (public=${bucket.public})`);
    } else {
      console.error(`! ${bucket.name}: FAILED HTTP ${res.status} - ${await res.text()}`);
    }
  }

  // 3. Verify
  const verifyRes = await fetch(`${url}/storage/v1/bucket`, { headers });
  const finalBuckets = (await verifyRes.json()) as Array<{ name: string; public: boolean }>;
  console.log("\n=== FINAL BUCKET LIST ===");
  for (const b of finalBuckets) {
    console.log(`  ${b.name} (public=${b.public})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
