"use client";

import Image from "next/image";
import { ChangeEvent } from "react";
import { X, Upload } from "lucide-react";
import { getInitials } from "../types";

interface OrganizationModalProps {
  isOpen: boolean;
  isPending: boolean;
  orgName: string;
  logoMode: "url" | "upload";
  logoUrl: string;
  logoPreview: string | null;
  feedback: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onOrgNameChange: (value: string) => void;
  onLogoModeChange: (mode: "url" | "upload") => void;
  onLogoUrlChange: (value: string) => void;
  onLogoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
}

export function OrganizationModal({
  isOpen,
  isPending,
  orgName,
  logoMode,
  logoUrl,
  logoPreview,
  feedback,
  onClose,
  onSubmit,
  onOrgNameChange,
  onLogoModeChange,
  onLogoUrlChange,
  onLogoUpload,
  onRemoveLogo,
}: OrganizationModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-[2px]">
      <div className="w-full max-w-3xl rounded-[34px] bg-white shadow-[0_40px_120px_rgba(0,0,0,0.24)]">
        <div className="flex items-start justify-between gap-6 px-8 py-7">
          <div>
            <p className="text-sm font-medium text-[#8c93a6]">Organization setup</p>
            <h2 className="mt-2 text-[2.4rem] font-semibold tracking-[-0.05em] text-[#232946]">
              Create organization
            </h2>
            <p className="mt-3 max-w-xl text-[1rem] leading-7 text-[#7c8496]">
              Set the organization name and logo here. This modal is the creation flow for the
              dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#f5f6fa] text-[#232946] transition hover:bg-[#eceff6]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="border-t border-[#f0f1f5] px-8 py-8"
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <label htmlFor="org-name-modal" className="text-sm font-medium text-[#232946]">
                Organization name
              </label>
              <input
                id="org-name-modal"
                name="name"
                value={orgName}
                onChange={(event) => onOrgNameChange(event.target.value)}
                className="w-full rounded-2xl border border-[#e8ecf4] px-4 py-3 text-sm text-[#232946] outline-none transition placeholder:text-[#a5afc0] focus:border-[#9eb7e5]"
                placeholder="Grace City Church"
                required
                disabled={isPending}
              />
            </div>

            <div className="rounded-[28px] bg-[#f7f9fc] p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9ba4b5]">Preview</p>
              <div className="mt-4 flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-[28px] bg-white">
                {logoPreview ? (
                  <Image
                    src={logoPreview}
                    alt={`${orgName || "Organization"} logo`}
                    width={104}
                    height={104}
                    className="h-[104px] w-[104px] object-cover"
                    unoptimized={logoPreview.startsWith("data:")}
                  />
                ) : (
                  <span className="text-3xl font-semibold text-[#232946]">
                    {getInitials(orgName)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[28px] bg-[#f7f9fc] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-[#232946]">Logo source</p>
                <p className="mt-1 text-sm text-[#7c8496]">
                  Paste a URL or upload a file up to 4MB.
                </p>
              </div>
              <div className="inline-flex rounded-2xl bg-white p-1 text-xs shadow-[inset_0_0_0_1px_#edf1f8]">
                <button
                  type="button"
                  onClick={() => onLogoModeChange("url")}
                  className={`rounded-xl px-4 py-2 transition ${
                    logoMode === "url"
                      ? "bg-[#232946] text-white"
                      : "text-[#7c8496] hover:text-[#232946]"
                  }`}
                >
                  Use URL
                </button>
                <button
                  type="button"
                  onClick={() => onLogoModeChange("upload")}
                  className={`rounded-xl px-4 py-2 transition ${
                    logoMode === "upload"
                      ? "bg-[#232946] text-white"
                      : "text-[#7c8496] hover:text-[#232946]"
                  }`}
                >
                  Upload
                </button>
              </div>
            </div>

            <div className="mt-5">
              {logoMode === "url" ? (
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(event) => onLogoUrlChange(event.target.value)}
                  className="w-full rounded-2xl border border-[#e8ecf4] bg-white px-4 py-3 text-sm text-[#232946] outline-none transition placeholder:text-[#a5afc0] focus:border-[#9eb7e5]"
                  placeholder="https://example.com/logo.png"
                  disabled={isPending}
                />
              ) : (
                <label
                  htmlFor="logo-file-modal"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-[26px] border border-dashed border-[#d8dfec] bg-white px-4 py-10 text-center transition hover:border-[#9eb7e5]"
                >
                  <Upload className="h-5 w-5 text-[#232946]" />
                  <span className="mt-3 text-sm font-medium text-[#232946]">
                    Upload logo file
                  </span>
                  <span className="mt-1 text-xs text-[#7c8496]">
                    PNG, JPG, SVG, or WEBP
                  </span>
                  <input
                    id="logo-file-modal"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={onLogoUpload}
                    disabled={isPending}
                  />
                </label>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onRemoveLogo}
                className="rounded-full border border-[#e2e6ef] px-4 py-2 text-xs font-medium text-[#5f6980] transition hover:border-[#cdd4e2] hover:text-[#232946]"
              >
                Remove logo
              </button>
              {feedback ? <p className="text-sm text-[#7c8496]">{feedback}</p> : null}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#e2e6ef] px-5 text-sm font-semibold text-[#232946] transition hover:border-[#cdd4e2]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#232946] px-5 text-sm font-semibold text-white transition hover:bg-[#1c223f] disabled:opacity-60"
            >
              {isPending ? "Creating..." : "Create organization"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

