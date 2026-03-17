import { db } from "~/db";
import { orgs, orgMembers } from "~/db/schema";

const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export async function seedLocalUser(): Promise<void> {
  await db
    .insert(orgs)
    .values({ id: LOCAL_ORG_ID, name: "Local" })
    .onConflictDoNothing();

  await db
    .insert(orgMembers)
    .values({
      orgId: LOCAL_ORG_ID,
      userId: LOCAL_USER_ID,
      role: "owner",
    })
    .onConflictDoNothing();

  console.log("[seed] local user and org ready");
}
