import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? "",
    role: (profile?.role as "admin" | "editor" | "viewer") ?? "viewer",
  };
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(minRole: "admin" | "editor" | "viewer") {
  const user = await requireAuth();
  const hierarchy = { admin: 3, editor: 2, viewer: 1 };
  if (hierarchy[user.role] < hierarchy[minRole]) {
    redirect("/");
  }
  return user;
}
