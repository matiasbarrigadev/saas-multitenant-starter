/**
 * Database type definitions for the Supabase client.
 *
 * In a real project, regenerate this file with:
 *   npx supabase gen types typescript --local > lib/supabase/types.gen.ts
 *
 * For the template, we hand-write a minimal type that matches the migrations
 * under `supabase/migrations/`. If you regenerate the file, the shape will
 * match; just keep `Database` exported under the same name.
 *
 * The Supabase clients (`server.ts`, `browser.ts`, `service.ts`) take this
 * `Database` as a generic parameter so `supabase.from("notes").select()` is
 * fully typed end-to-end.
 *
 * Usage:
 *   import type { Database } from "@/lib/supabase/types";
 *   const supabase = createClient<Database>();
 *   // supabase.from("notes") is now typed.
 */

/**
 * Row shape for each table. Use `Insert`/`Update` for write payloads.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Role = "owner" | "admin" | "member";

export interface Company {
  id: string;
  slug: string;
  name: string;
  settings: Json;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  company_id: string;
  slug: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  workspace_id: string;
  company_id: string;
  user_id: string;
  role: Role;
  invited_at: string;
  joined_at: string;
}

export interface Note {
  id: string;
  workspace_id: string;
  title: string;
  body: string;
  author_id: string;
  created_at: string;
  updated_at: string;
}

/** Platform-level role. Lives in app_metadata.platform_role, stamped
 * by the custom_access_token_hook (0008_hook_platform_role.sql). */
export type PlatformRole = "super_admin";

export interface AuditEvent {
  id: string;
  actor_user_id: string | null;
  company_id: string | null;
  workspace_id: string | null;
  event_type: string;
  payload: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface WorkspaceModuleGrant {
  id: string;
  workspace_id: string;
  module_key: string;
  granted_by: string | null;
  granted_at: string;
}

/**
 * Database interface consumed by the Supabase typed client.
 *
 * Kept hand-written for the template. If you run `supabase gen types`, the
 * generated structure matches this shape (with one extra `__InternalSupabase`
 * post-fix; just rename if needed).
 */
export interface Database {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Company>;
      };
      workspaces: {
        Row: Workspace;
        Insert: Omit<Workspace, "id" | "created_at" | "updated_at"> & {
          id?: string;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Workspace>;
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at"> & { created_at?: string };
        Update: Partial<Profile>;
      };
      memberships: {
        Row: Membership;
        Insert: Omit<Membership, "id" | "invited_at" | "joined_at"> & {
          id?: string;
          invited_at?: string;
          joined_at?: string;
        };
        Update: Partial<Membership>;
      };
      notes: {
        Row: Note;
        Insert: Omit<Note, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Note>;
      };
      audit_events: {
        Row: AuditEvent;
        Insert: Omit<AuditEvent, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<AuditEvent>;
      };
      workspace_module_grants: {
        Row: WorkspaceModuleGrant;
        Insert: Omit<WorkspaceModuleGrant, "id" | "granted_at"> & {
          id?: string;
          granted_at?: string;
        };
        Update: Partial<WorkspaceModuleGrant>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      custom_access_token_hook: {
        Args: { event: Json };
        Returns: Json;
      };
      current_workspace_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      current_company_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      current_user_role: {
        Args: Record<string, never>;
        Returns: Role | null;
      };
      user_can_access_workspace: {
        Args: { workspace_id: string };
        Returns: boolean;
      };
      current_platform_role: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      is_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_company_owner: {
        Args: { target_company_id: string };
        Returns: boolean;
      };
      is_company_admin: {
        Args: { target_company_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      role: Role;
    };
  };
}

/**
 * Helper alias: the Supabase client typed against our schema.
 *
 * Usage:
 *   import type { TypedSupabaseClient } from "@/lib/supabase/types";
 *   const supabase: TypedSupabaseClient = ...;
 */
export type TypedSupabaseClient = ReturnType<
  typeof import("@supabase/supabase-js").createClient<Database>
>;