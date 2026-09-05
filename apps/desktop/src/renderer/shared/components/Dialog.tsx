"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { PortalContainerContext } from "./portal-container";

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  contentClassName?: string;
}

export function Dialog({
  title,
  children,
  onClose,
  contentClassName,
}: DialogProps) {
  // Held as state, not a ref, so that the menus below re-render and portal into
  // the dialog as soon as it is attached.
  const [dialogNode, setDialogNode] = useState<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!dialogNode) return;

    if (!dialogNode.open) {
      dialogNode.showModal();
    }

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };

    dialogNode.addEventListener("cancel", handleCancel);
    return () => {
      dialogNode.removeEventListener("cancel", handleCancel);
      if (dialogNode.open) {
        dialogNode.close();
      }
    };
  }, [dialogNode]);

  return (
    <dialog
      ref={setDialogNode}
      aria-labelledby="dialog-title"
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-sm rounded-lg border border-border bg-card p-4 text-foreground shadow-xl backdrop:bg-black/70",
        contentClassName,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="dialog-title"
          className="text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <PortalContainerContext.Provider value={dialogNode}>
        {children}
      </PortalContainerContext.Provider>
    </dialog>
  );
}
