"use client";

import { useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { uploadProfileImage } from "@/services/userService";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_MB = 2;

export interface ProfileImageUploadProps {
    uid: string;
    name: string;
    photoURL?: string | null;
    onSuccess?: () => void;
    size?: "sm" | "md" | "lg";
}

export default function ProfileImageUpload({
    uid,
    name,
    photoURL,
    onSuccess,
    size = "lg",
}: ProfileImageUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > MAX_MB * 1024 * 1024) {
            setError(`画像は ${MAX_MB}MB までです`);
            return;
        }
        if (!ACCEPT.split(",").some((t) => file.type === t.trim())) {
            setError("JPEG / PNG / WebP を選んでください");
            return;
        }
        setError(null);
        setUploading(true);
        try {
            await uploadProfileImage(uid, file);
            onSuccess?.();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message || "アップロードに失敗しました");
            if (process.env.NODE_ENV === "development") {
                console.error("[ProfileImageUpload] upload error:", err);
            }
        } finally {
            setUploading(false);
        }
    };

    return (
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
                <Avatar photoURL={photoURL} name={name} size={size} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={handleFile}
                    style={{ display: "none" }}
                    aria-hidden
                />
                <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: "0.875rem", padding: "0.375rem 0.75rem" }}
                    disabled={uploading}
                    onClick={() => inputRef.current?.click()}
                >
                    {uploading ? "アップロード中..." : photoURL ? "画像を変更" : "画像を設定"}
                </button>
                {error && (
                    <span style={{ fontSize: "0.8rem", color: "var(--destructive)" }}>{error}</span>
                )}
            </div>
        </div>
    );
}
