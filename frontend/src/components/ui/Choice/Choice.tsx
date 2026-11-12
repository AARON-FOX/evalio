import { useId } from "react";
import type { ReactNode } from "react";

import type { InputHTMLAttributes } from "react";

import styles from "./Choice.module.scss";

interface ChoiceProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  type: "radio" | "checkbox";
  label: ReactNode;
  description?: string;
}

export function Choice({
  id,
  type,
  label,
  description,
  className = "",
  disabled = false,
  ...props
}: ChoiceProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label
      htmlFor={inputId}
      className={[styles.choice, disabled ? styles.disabled : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        {...props}
        id={inputId}
        type={type}
        disabled={disabled}
        className={styles.input}
      />

      <span className={styles.content}>
        <span className={styles.label}>{label}</span>

        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
    </label>
  );
}
