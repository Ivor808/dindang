import { db } from "~/db";
import { orgs, orgMembers } from "~/db/schema";
import { LOCAL_USER_ID, LOCAL_ORG_ID } from "~/server/auth";

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
