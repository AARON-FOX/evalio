import type { HTMLAttributes } from "react";

import styles from "./Alert.module.scss";

type AlertTone = "success" | "error" | "info";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

export function Alert({
  tone = "info",
  title,
  children,
  className = "",
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      role={tone === "error" ? "alert" : "status"}
      className={[styles.alert, styles[tone], className]
        .filter(Boolean)
        .join(" ")}
    >
      {title && <strong className={styles.title}>{title}</strong>}

      <div className={styles.content}>{children}</div>
    </div>
  );
}
