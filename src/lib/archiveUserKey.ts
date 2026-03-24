/**
 * 表示名だけで退職者シフト用データをまとめる内部キー（Firestore の userId / docId 用）
 * 同じ表記の名前なら常に同じキーになる
 */
export function archiveUserKeyFromDisplayName(displayName: string): string {
    const t = displayName.trim();
    if (!t) {
        return "";
    }
    const bytes = new TextEncoder().encode(t);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]!);
    }
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `name_${b64}`;
}

/** `name_<base64url>` を元の表示名に戻す（シフト表・給与集計の照合に使用） */
export function displayNameFromArchiveUserKey(key: string): string | null {
    if (!key.startsWith("name_")) return null;
    const b64url = key.slice("name_".length);
    if (!b64url) return null;
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}
