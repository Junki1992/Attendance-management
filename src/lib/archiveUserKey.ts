/**
 * 表示名だけで退職シフト用データをまとめる内部キー（Firestore の userId / docId 用）
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
