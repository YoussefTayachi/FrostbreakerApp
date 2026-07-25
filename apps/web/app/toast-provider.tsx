"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";
/** Optionale Aktion im Toast, aktuell fuer "Rueckgaengig" nach dem Loeschen. */
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; type: ToastType; action?: ToastAction };

const ToastContext = createContext<{
  push: (message: string, type?: ToastType, action?: ToastAction) => void;
}>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastType, string> = { success: "✓", error: "✕", info: "i" };
const DOT: Record<ToastType, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  info: "bg-sky-500",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string, type: ToastType = "info", action?: ToastAction) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, type, action }]);
    // Mit Aktion laenger stehenlassen: 4 Sekunden reichen nicht, um eine
    // Loeschung zu bemerken und bewusst zurueckzunehmen.
    window.setTimeout(
      () => {
        setToasts((t) => t.filter((x) => x.id !== id));
      },
      action ? 8000 : 4000
    );
  }, []);

  function dismiss(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            className="fade-up pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-lg border border-edge/60 bg-panel px-4 py-3 text-sm text-ink shadow-2xl"
          >
            <span
              className={
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white " +
                DOT[toast.type]
              }
            >
              {ICONS[toast.type]}
            </span>
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(toast.id);
                  toast.action!.onClick();
                }}
                className="-my-0.5 shrink-0 rounded-md border border-edge2 px-2 py-1 text-xs font-medium text-soft transition-colors hover:border-edge3 hover:text-ink"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
