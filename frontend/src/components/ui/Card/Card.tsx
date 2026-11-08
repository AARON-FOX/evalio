import type { HTMLAttributes } from "react";

import styles from "./Card.module.scss";

type CardPadding = "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  elevated?: boolean;
}

export function Card({
  padding = "md",
  elevated = false,
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      {...props}
      className={[
        styles.card,
        styles[padding],
        elevated ? styles.elevated : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
