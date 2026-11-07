import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../services/api";

import {
  getTests,
  getTestDetails,
  createTest,
  updateTest,
  addTestQuestion,
  publishTest,
  type TestRecord,
  type TestDetails,
  type TestKind,
  type QuestionType,
} from "../../services/testsApi";

import "./TestBuilder.css";

interface DraftOption {
  key: string;
  text: string;
  isCorrect: boolean;
}

interface QuestionDraft {
  text: string;
  questionType: QuestionType;
  options: DraftOption[];
}

function newOption(): DraftOption {
  return {
    key: crypto.randomUUID(),
    text: "",
    isCorrect: false,
  };
}

function newQuestionDraft(): QuestionDraft {
  return {
    text: "",
    questionType: "single_choice",
    options: [newOption(), newOption()],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Невідома помилка";
}

export function TestBuilder() {
  const previousUserId = useRef<string | null | undefined>(undefined);

  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const [tests, setTests] = useState<TestRecord[]>([]);
  const [selected, setSelected] = useState<TestDetails | null>(null);

  // New test form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TestKind>("test");

  // Existing draft metadata
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");

  // New question form
  const [question, setQuestion] = useState<QuestionDraft>(newQuestionDraft);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Observe Supabase authentication

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;

      // Reset state only when the user changes.
      if (previousUserId.current !== nextUserId) {
        previousUserId.current = nextUserId;

        setRole(null);
        setTests([]);
        setSelected(null);

        setLoading(Boolean(nextUserId));
        setError("");
        setMessage("");
      }

      setUserId(nextUserId);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load access role and user's tests
  useEffect(() => {
    if (!authReady || !userId) return;

    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session || session.user.id !== userId) {
          throw new Error("Authentication required");
        }

        const user = await getCurrentUser(
          session.access_token,
          controller.signal,
        );

        if (cancelled) return;

        setRole(user.role);

        if (user.role === "creator") {
          const allTests = await getTests();

          if (!cancelled) {
            setTests(allTests.filter((test) => test.creator_id === user.id));
          }
        }
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(errorText(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authReady, userId]);

  async function refreshTests() {
    const allTests = await getTests();

    setTests(allTests.filter((test) => test.creator_id === userId));
  }

  function openDetails(details: TestDetails) {
    setSelected(details);
    setMetaTitle(details.title);
    setMetaDescription(details.description ?? "");
    setQuestion(newQuestionDraft());
  }

  async function runAction(action: () => Promise<string>) {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const resultMessage = await action();
      setMessage(resultMessage);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const created = await createTest({
        title: title.trim(),
        description: description.trim() || null,
        kind,
      });

      const details = await getTestDetails(created.id);
      openDetails(details);

      setTitle("");
      setDescription("");
      setKind("test");

      await refreshTests();
      return "Чернетку успішно створено.";
    });
  }

  async function handleOpen(id: string) {
    await runAction(async () => {
      const details = await getTestDetails(id);
      openDetails(details);

      return `Відкрито: ${details.title}`;
    });
  }

  async function handleSaveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const id = selected.id;

    await runAction(async () => {
      await updateTest(id, {
        title: metaTitle.trim(),
        description: metaDescription.trim() || null,
      });

      openDetails(await getTestDetails(id));
      await refreshTests();

      return "Зміни тесту збережено.";
    });
  }

  function updateOption(index: number, text: string) {
    setQuestion((current) => ({
      ...current,
      options: current.options.map((option, i) =>
        i === index ? { ...option, text } : option,
      ),
    }));
  }

  function selectCorrect(index: number) {
    setQuestion((current) => ({
      ...current,
      options: current.options.map((option, i) => ({
        ...option,
        isCorrect:
          current.questionType === "single_choice"
            ? i === index
            : i === index
              ? !option.isCorrect
              : option.isCorrect,
      })),
    }));
  }

  function changeQuestionType(type: QuestionType) {
    setQuestion((current) => ({
      ...current,
      questionType: type,
      options: current.options.map((option) => ({
        ...option,
        isCorrect: false,
      })),
    }));
  }

  function removeOption(index: number) {
    setQuestion((current) => ({
      ...current,
      options: current.options.filter((_, i) => i !== index),
    }));
  }

  async function handleAddQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const currentTest = selected;
    const options = question.options.map((option) => ({
      text: option.text.trim(),
      isCorrect: currentTest.kind === "test" ? option.isCorrect : false,
    }));

    if (options.some((option) => !option.text)) {
      setError("Заповни всі варіанти відповідей.");
      return;
    }

    const correctCount = options.filter((option) => option.isCorrect).length;

    if (currentTest.kind === "test") {
      if (question.questionType === "single_choice" && correctCount !== 1) {
        setError("Познач одну правильну відповідь.");
        return;
      }

      if (question.questionType === "multiple_choice" && correctCount < 2) {
        setError("Познач щонайменше дві правильні відповіді.");
        return;
      }
    }

    await runAction(async () => {
      await addTestQuestion(currentTest.id, {
        text: question.text.trim(),
        questionType: question.questionType,
        options,
      });

      openDetails(await getTestDetails(currentTest.id));

      return "Питання додано до чернетки.";
    });
  }

  async function handlePublish() {
    if (!selected || selected.questions.length === 0) {
      return;
    }

    const id = selected.id;

    if (
      !window.confirm(
        "Опублікувати тест? Після публікації його " +
          "не можна буде редагувати через поточний API.",
      )
    ) {
      return;
    }

    await runAction(async () => {
      await publishTest(id);

      openDetails(await getTestDetails(id));
      await refreshTests();

      return "Тест успішно опубліковано.";
    });
  }

  if (!authReady || loading) {
    return <p>Завантаження конструктора...</p>;
  }

  if (!userId) {
    return (
      <section className="test-builder">
        <h2>Конструктор тестів</h2>
        <p>Спочатку увійди до Evalio.</p>
      </section>
    );
  }

  if (role !== "creator") {
    return (
      <section className="test-builder">
        <h2>Конструктор тестів</h2>
        {error && <p role="alert">{error}</p>}
        <p>Конструктор доступний лише викладачам.</p>
      </section>
    );
  }

  return (
    <section className="test-builder">
      <header className="tb-header">
        <div>
          <h2>Конструктор тестів</h2>
          <p>Створення тестів та опитувань Evalio</p>
        </div>
      </header>

      {error && (
        <p className="tb-alert tb-error" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="tb-alert tb-success" role="status">
          {message}
        </p>
      )}

      <div className="tb-layout">
        <aside className="tb-sidebar">
          <h3>Мої тести</h3>

          <button
            type="button"
            disabled={working}
            onClick={() => {
              setSelected(null);
              setError("");
              setMessage("");
            }}
          >
            + Новий тест
          </button>

          {tests.length === 0 && <p>Тестів поки немає.</p>}

          {tests.map((test) => (
            <button
              key={test.id}
              type="button"
              disabled={working}
              className={
                selected?.id === test.id
                  ? "tb-test-item active"
                  : "tb-test-item"
              }
              onClick={() => void handleOpen(test.id)}
            >
              <strong>{test.title}</strong>
              <small>
                {test.kind === "test" ? "Тест" : "Опитування"}
                {" · "}
                {test.status === "draft" ? "Чернетка" : "Опубліковано"}
              </small>
            </button>
          ))}
        </aside>

        <div className="tb-main">
          {!selected ? (
            <form className="tb-panel" onSubmit={handleCreate}>
              <h3>Створити новий тест</h3>

              <label>
                Назва
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                />
              </label>

              <label>
                Опис
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                />
              </label>

              <label>
                Режим
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as TestKind)}
                >
                  <option value="test">Тест з оцінюванням</option>
                  <option value="survey">Опитування без оцінювання</option>
                </select>
              </label>

              <button type="submit" disabled={working || !title.trim()}>
                Створити чернетку
              </button>
            </form>
          ) : (
            <>
              <div className="tb-panel">
                <div className="tb-heading">
                  <h3>{selected.title}</h3>
                  <span className="tb-status">
                    {selected.status === "draft" ? "Чернетка" : "Опубліковано"}
                  </span>
                </div>

                <p>
                  {selected.kind === "test"
                    ? "Тест з оцінюванням"
                    : "Опитування"}
                </p>

                {selected.status === "draft" && (
                  <form onSubmit={handleSaveMetadata}>
                    <label>
                      Назва
                      <input
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        maxLength={200}
                        required
                      />
                    </label>

                    <label>
                      Опис
                      <textarea
                        value={metaDescription}
                        onChange={(e) => setMetaDescription(e.target.value)}
                        maxLength={2000}
                        rows={2}
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={working || !metaTitle.trim()}
                    >
                      Зберегти назву та опис
                    </button>
                  </form>
                )}
              </div>

              <div className="tb-panel">
                <h3>Питання ({selected.questions.length})</h3>

                {selected.questions.length === 0 && (
                  <p>Поки немає жодного питання.</p>
                )}

                {selected.questions.map((item) => (
                  <div className="tb-saved-question" key={item.id}>
                    <h4>
                      {item.position}. {item.text}
                    </h4>

                    <p>
                      {item.question_type === "single_choice"
                        ? "Одна відповідь"
                        : "Кілька відповідей"}
                    </p>

                    <ol>
                      {item.options.map((option) => (
                        <li key={option.id}>{option.text}</li>
                      ))}
                    </ol>
                  </div>
                ))}

                {selected.status === "published" && (
                  <p>Цей тест опубліковано. Редагування недоступне.</p>
                )}
              </div>

              {selected.status === "draft" && (
                <form className="tb-panel" onSubmit={handleAddQuestion}>
                  <h3>Додати питання</h3>

                  <label>
                    Текст питання
                    <textarea
                      value={question.text}
                      onChange={(e) =>
                        setQuestion((current) => ({
                          ...current,
                          text: e.target.value,
                        }))
                      }
                      maxLength={5000}
                      required
                      rows={3}
                    />
                  </label>

                  <label>
                    Тип питання
                    <select
                      value={question.questionType}
                      onChange={(e) =>
                        changeQuestionType(e.target.value as QuestionType)
                      }
                    >
                      <option value="single_choice">Одна відповідь</option>
                      <option value="multiple_choice">Кілька відповідей</option>
                    </select>
                  </label>

                  <h4>Варіанти відповідей</h4>

                  {question.options.map((option, index) => (
                    <div className="tb-option" key={option.key}>
                      {selected.kind === "test" && (
                        <input
                          type={
                            question.questionType === "single_choice"
                              ? "radio"
                              : "checkbox"
                          }
                          name="correct-option"
                          checked={option.isCorrect}
                          onChange={() => selectCorrect(index)}
                          aria-label={`Правильна відповідь ${index + 1}`}
                        />
                      )}

                      <input
                        type="text"
                        value={option.text}
                        placeholder={`Варіант ${index + 1}`}
                        maxLength={1000}
                        required
                        onChange={(e) => updateOption(index, e.target.value)}
                      />

                      <button
                        type="button"
                        disabled={working || question.options.length <= 2}
                        onClick={() => removeOption(index)}
                        aria-label={`Видалити варіант ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {selected.kind === "test" && (
                    <p className="tb-hint">
                      Познач правильні відповіді ліворуч від варіантів.
                    </p>
                  )}

                  {selected.kind === "survey" && (
                    <p className="tb-hint">
                      Опитування не має правильних відповідей.
                    </p>
                  )}

                  <div className="tb-actions">
                    <button
                      type="button"
                      disabled={working || question.options.length >= 12}
                      onClick={() =>
                        setQuestion((current) => ({
                          ...current,
                          options: [...current.options, newOption()],
                        }))
                      }
                    >
                      + Додати варіант
                    </button>

                    <button
                      type="submit"
                      disabled={working || !question.text.trim()}
                    >
                      Зберегти питання
                    </button>
                  </div>
                </form>
              )}

              {selected.status === "draft" && (
                <div className="tb-panel">
                  <h3>Публікація</h3>
                  <p>Після публікації тест стане доступним для проходження.</p>

                  <button
                    type="button"
                    disabled={working || selected.questions.length === 0}
                    onClick={() => void handlePublish()}
                  >
                    Опублікувати тест
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
