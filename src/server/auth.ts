import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { orgMembers, orgs } from "~/db/schema";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export function createSupabaseServerClient(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookies,
      setAll: () => {},
    },
  });
}

function parseCookies(cookieHeader: string): { name: string; value: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((c) => {
    const [name, ...rest] = c.trim().split("=");
    return { name: name!, value: rest.join("=") };
  });
}

export async function requireAuth(): Promise<string> {
  const request = getRequest();
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

export async function getActiveOrgId(userId: string): Promise<string> {
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
  const membership = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (membership.length > 0) return membership[0]!.orgId;

  const request = getRequest();
  const supabase = createSupabaseServerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const displayName = user?.user_metadata?.full_name || user?.email || "My";
  return createOrgForUser(userId, displayName);
}

export async function requireAuthWithOrg(): Promise<{ userId: string; orgId: string }> {
  const userId = await requireAuth();
  const orgId = await ensureOrg(userId);
  return { userId, orgId };
}
