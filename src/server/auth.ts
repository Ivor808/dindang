import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { orgMembers, orgs } from "~/db/schema";
import { isLocalMode } from "~/lib/mode";

const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export async function requireAuth(): Promise<string> {
  if (isLocalMode()) return LOCAL_USER_ID;

  const { createServerClient } = await import("@supabase/ssr");
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const supabase = createSupabaseServerClient(createServerClient, request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

export async function getActiveOrgId(userId: string): Promise<string> {
  if (isLocalMode()) return LOCAL_ORG_ID;

  const membership = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (membership.length === 0) throw new Error("User has no org");
  return membership[0]!.orgId;
}

export async function requireRole(
  userId: string,
  orgId: string,
  minimumRole: "owner" | "admin" | "member",
): Promise<{ role: string }> {
  if (isLocalMode()) return { role: "owner" };

  const membership = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);
  if (membership.length === 0) throw new Error("Not a member of this org");
  const role = membership[0]!.role;
  const hierarchy = { owner: 3, admin: 2, member: 1 };
  if (hierarchy[role as keyof typeof hierarchy] < hierarchy[minimumRole]) {
    throw new Error(`Requires ${minimumRole} role`);
  }
  return { role };
}

export async function createOrgForUser(userId: string, displayName: string): Promise<string> {
  const org = await db
    .insert(orgs)
    .values({ name: `${displayName}'s Workspace` })
    .returning({ id: orgs.id });
  const orgId = org[0]!.id;
  await db.insert(orgMembers).values({ orgId, userId, role: "owner" });
  return orgId;
}

export async function ensureOrg(userId: string): Promise<string> {
  if (isLocalMode()) return LOCAL_ORG_ID;

  const membership = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (membership.length > 0) return membership[0]!.orgId;

  const { createServerClient } = await import("@supabase/ssr");
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const supabase = createSupabaseServerClient(createServerClient, request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const displayName = user?.user_metadata?.full_name || user?.email || "My";
  return createOrgForUser(userId, displayName);
}

export async function requireAuthWithOrg(): Promise<{ userId: string; orgId: string }> {
  if (isLocalMode()) return { userId: LOCAL_USER_ID, orgId: LOCAL_ORG_ID };

  const userId = await requireAuth();
  const orgId = await ensureOrg(userId);
  return { userId, orgId };
}

export { LOCAL_USER_ID, LOCAL_ORG_ID };

function createSupabaseServerClient(createServerClient: any, request: Request) {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookies,
        setAll: () => {},
      },
    },
  );
}

function parseCookies(cookieHeader: string): { name: string; value: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((c) => {
    const [name, ...rest] = c.trim().split("=");
    return { name: name!, value: rest.join("=") };
  });
}
