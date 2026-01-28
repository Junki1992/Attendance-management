"use client";

/** 名前の先頭1文字（絵文字・サロゲート対も考慮） */
function getInitial(name: string): string {
    if (!name || typeof name !== "string") return "?";
    const t = name.trim();
    if (!t) return "?";
    return [...t][0]!.toUpperCase();
}

type Size = "sm" | "md" | "lg";

const sizePx: Record<Size, number> = {
    sm: 28,
    md: 36,
    lg: 44,
};

export interface AvatarProps {
    /** 画像URL（未設定時は頭文字表示） */
    photoURL?: string | null;
    /** 頭文字フォールバック用の名前 */
    name: string;
    size?: Size;
    className?: string;
    style?: React.CSSProperties;
}

export default function Avatar({ photoURL, name, size = "md", className, style }: AvatarProps) {
    const px = sizePx[size];
    const base: React.CSSProperties = {
        width: px,
        height: px,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size === "sm" ? "0.75rem" : size === "md" ? "0.875rem" : "1rem",
        fontWeight: 600,
        backgroundColor: "var(--primary)",
        color: "var(--primary-foreground)",
        overflow: "hidden",
        ...style,
    };

    if (photoURL) {
        return (
            <img
                src={photoURL}
                alt={name}
                className={className}
                style={base}
                referrerPolicy="no-referrer"
                loading="lazy"
            />
        );
    }

    return (
        <span className={className} style={base} aria-hidden>
            {getInitial(name)}
        </span>
    );
}
