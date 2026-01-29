"use client";

import { useState } from "react";
import { useScripture } from "../hooks/useScripture";
import { Button } from "@/components/ui/button";
import { Download, Trash2, FileUp, Loader2 } from "lucide-react";

export function ScriptureDownloader() {
  const { versions, activeImport, importFile, uninstallVersion } = useScripture();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await uninstallVersion(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleManualImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importFile(file);
    // Reset input
    e.target.value = "";
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Bible Versions
        </h3>
      </div>

      {activeImport && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground capitalize">
            <span>{activeImport.phase}...</span>
            <span>{activeImport.percent}%</span>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${activeImport.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No versions installed for offline use.
          </p>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between p-2 rounded-md bg-secondary/50 group"
            >
              <div>
                <p className="text-sm font-medium">{v.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {v.code}{" "}
                  {v.size > 0 && `• ${(v.size / 1024 / 1024).toFixed(2)} MB`}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                onClick={() => handleDelete(v.id)}
                disabled={deletingId === v.id}
              >
                {deletingId === v.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="pt-2 border-t">
        <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer py-2 border border-dashed rounded-md transition border-border">
          <FileUp className="h-4 w-4" />
          <span>Import Bible File (XML/JSON)</span>
          <input
            type="file"
            className="hidden"
            accept=".zip,.json,.xml"
            onChange={handleManualImport}
          />
        </label>
      </div>
    </div>
  );
}
