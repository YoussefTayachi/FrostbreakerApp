"use client";
import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_COOKIE, type WorkspaceSummary } from "@/lib/workspace/shared";

type WorkspaceContextValue = {
  workspaceId: string;
  workspaceName: string;
  workspaces: WorkspaceSummary[];
  switchWorkspace: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaceId: "",
  workspaceName: "",
  workspaces: [],
  switchWorkspace: () => {},
});

// workspaceId/workspaces kommen vom Server (Cookie + Query in layout.tsx) — dadurch
// ist der erste Client-Render identisch zum Server-Render, kein Hydration-Mismatch,
// analog zu LanguageProvider fuer die UI-Sprache.
export function WorkspaceProvider({
  workspaceId,
  workspaceName,
  workspaces,
  children,
}: {
  workspaceId: string;
  workspaceName: string;
  workspaces: WorkspaceSummary[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  function switchWorkspace(id: string) {
    document.cookie = `${WORKSPACE_COOKIE}=${id}; path=/; max-age=31536000`;
    router.refresh();
  }
  return (
    <WorkspaceContext.Provider value={{ workspaceId, workspaceName, workspaces, switchWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** Bequemer Zugriff auf den aktuell ausgewaehlten Workspace in Client-Komponenten. */
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
