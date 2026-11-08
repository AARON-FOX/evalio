import { useState } from "react";

import { Button } from "../components/ui/Button/Button";
import { TextField } from "../components/ui/TextField/TextField";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import { Choice } from "../components/ui/Choice/Choice";

import styles from "./UiKitPage.module.scss";

export function UiKitPage() {
  const [title, setTitle] = useState("");
  const [answer, setAnswer] = useState("const");
  const [checked, setChecked] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  return (
    <section className={styles.page}>
      <header>
        <h1>Evalio UI Kit</h1>
        <p>Базові компоненти дизайн-системи.</p>
      </header>

      <div className={styles.grid}>
        <Card elevated>
          <h2>Кнопки</h2>

          <div className={styles.actions}>
            <Button onClick={() => setShowSuccess(true)}>Primary</Button>

            <Button variant="secondary" onClick={() => setShowSuccess(true)}>
              Secondary
            </Button>

            <Button variant="outline" onClick={() => setShowSuccess(true)}>
              Outline
            </Button>

            <Button variant="ghost" onClick={() => setShowSuccess(true)}>
              Ghost
            </Button>

            <Button variant="danger" onClick={() => setShowSuccess(false)}>
              Danger
            </Button>

            <Button disabled>Disabled</Button>
          </div>
        </Card>

        <Card elevated>
          <h2>Поля вводу</h2>

          <div className={styles.fields}>
            <TextField
              label="Назва тесту"
              placeholder="Основи JavaScript"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              hint="Від 3 до 200 символів"
              error={
                title.length > 0 && title.trim().length < 3
                  ? "Назва занадто коротка"
                  : undefined
              }
              required
            />

            <TextField
              label="Email"
              type="email"
              placeholder="student@example.com"
            />
          </div>
        </Card>

        <Card elevated>
          <h2>Варіанти відповідей</h2>

          <fieldset className={styles.choiceGroup}>
            <legend>Яке ключове слово оголошує константу?</legend>

            {["const", "let", "var"].map((item) => (
              <Choice
                key={item}
                type="radio"
                name="demo-question"
                label={item}
                checked={answer === item}
                onChange={() => setAnswer(item)}
              />
            ))}
          </fieldset>

          <Choice
            type="checkbox"
            label="Погоджуюся з умовами"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
        </Card>

        <Card elevated>
          <h2>Повідомлення</h2>

          <div className={styles.fields}>
            <Alert tone="info" title="Інформація">
              Тест доступний для редагування.
            </Alert>

            <Alert tone="success" title="Успішно">
              Тест збережено.
            </Alert>

            <Alert tone="error" title="Помилка">
              Не вдалося зберегти зміни.
            </Alert>
          </div>
        </Card>
      </div>

      {showSuccess && (
        <div className={styles.notification}>
          <Alert tone="success" title="Демонстрація">
            Кнопка працює.
          </Alert>
        </div>
      )}
    </section>
  );
}
