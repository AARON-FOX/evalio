import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  FilePlus2,
  Info,
  PencilLine,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "../components/ui/Button/Button";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import {
  createTest,
  getTestDetails,
  publishTest,
  updateTest,
} from "../services/testsApi";

import type { TestDetails, TestKind, TestQuestion } from "../services/testsApi";

import {
  createDraftRevision,
  getVersions,
  getTestSettings,
  updateTestSettings,
  addWeightedQuestion,
  updateWeightedQuestion,
} from "../services/testVersioningApi";

import type {
  TestSettings,
  VersionRecord,
  WeightedQuestionInput,
} from "../services/testVersioningApi";

import {
  getEditableTest,
  deleteDraftQuestion,
} from "../services/questionEditorApi";

import type {
  EditableQuestion,
  EditableTest,
} from "../services/questionEditorApi";

import styles from "./TestEditorPage.module.scss";

type ChoiceKind = "single_choice" | "multiple_choice";
type QuestionOption = { key: string; text: string; isCorrect: boolean };
type QuestionForm = {
  text: string;
  questionType: ChoiceKind;
  points: number;
  explanation: string;
  options: QuestionOption[];
};
type MetadataForm = {
  title: string;
  description: string;
  subject: string;
  classGroup: string;
  durationMinutes: string;
  maxAttempts: string;
  availableUntil: string;
  showResultImmediately: boolean;
  showCorrectAnswers: boolean;
  shuffleQuestions: boolean;
};
type Loaded = {
  settings: TestSettings;
  versions: VersionRecord[];
  editor: EditableTest | null;
  published: TestDetails | null;
};

const blankOption = (): QuestionOption => ({
  key: crypto.randomUUID(),
  text: "",
  isCorrect: false,
});
const newQuestion = (): QuestionForm => ({
  text: "",
  questionType: "single_choice",
  points: 1,
  explanation: "",
  options: [blankOption(), blankOption()],
});
function questionFromSaved(question: EditableQuestion): QuestionForm {
  return {
    text: question.text,
    questionType: question.question_type,
    points: question.points,
    explanation: question.explanation ?? "",
    options: question.options.map((option) => ({
      key: option.id,
      text: option.text,
      isCorrect: option.isCorrect,
    })),
  };
}
function pointsOf(question: TestQuestion): number {
  return "points" in question && typeof question.points === "number"
    ? question.points
    : 1;
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Сталася невідома помилка.";
}
function pad(value: number): string {
  return String(value).padStart(2, "0");
}
function toLocalDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function metadataFromSettings(settings: TestSettings): MetadataForm {
  return {
    title: settings.title,
    description: settings.description ?? "",
    subject: settings.subject ?? "",
    classGroup: settings.class_group ?? "",
    durationMinutes:
      settings.duration_minutes == null
        ? ""
        : String(settings.duration_minutes),
    maxAttempts:
      settings.max_attempts == null ? "" : String(settings.max_attempts),
    availableUntil: toLocalDateTime(settings.available_until),
    showResultImmediately: settings.show_result_immediately,
    showCorrectAnswers: settings.show_correct_answers,
    shuffleQuestions: settings.shuffle_questions,
  };
}
function settingsPayload(form: MetadataForm) {
  let availableUntil: string | null = null;
  if (form.availableUntil) {
    const date = new Date(form.availableUntil);
    if (!Number.isFinite(date.getTime()))
      throw new Error("Перевір дату завершення доступу.");
    // The HTML datetime-local value is interpreted in the browser's local timezone.
    // ISO includes UTC offset (Z), as required by the Express Zod schema.
    availableUntil = date.toISOString();
  }
  const duration =
    form.durationMinutes === "" ? null : Number(form.durationMinutes);
  const attempts = form.maxAttempts === "" ? null : Number(form.maxAttempts);
  if (
    duration != null &&
    (!Number.isInteger(duration) || duration < 1 || duration > 180)
  ) {
    throw new Error("Тривалість має бути від 1 до 180 хвилин.");
  }
  if (
    attempts != null &&
    (!Number.isInteger(attempts) || attempts < 1 || attempts > 20)
  ) {
    throw new Error("Кількість спроб має бути від 1 до 20.");
  }
  return {
    subject: form.subject.trim() || null,
    classGroup: form.classGroup.trim() || null,
    durationMinutes: duration,
    maxAttempts: attempts,
    availableUntil,
    showResultImmediately: form.showResultImmediately,
    showCorrectAnswers: form.showCorrectAnswers,
    shuffleQuestions: form.shuffleQuestions,
  };
}
function questionPayload(
  question: QuestionForm,
  kind: TestKind,
): WeightedQuestionInput {
  const text = question.text.trim();
  const options = question.options.map((option) => ({
    text: option.text.trim(),
    isCorrect: kind === "test" && option.isCorrect,
  }));
  const correct = options.filter((option) => option.isCorrect).length;
  if (!text) throw new Error("Введи текст питання.");
  if (
    options.length < 2 ||
    options.length > 12 ||
    options.some((option) => !option.text)
  ) {
    throw new Error("Додай від 2 до 12 непорожніх варіантів відповіді.");
  }
  if (
    kind === "test" &&
    question.questionType === "single_choice" &&
    correct !== 1
  ) {
    throw new Error("Для цього питання познач рівно одну правильну відповідь.");
  }
  if (
    kind === "test" &&
    question.questionType === "multiple_choice" &&
    correct < 2
  ) {
    throw new Error(
      "Для питання з кількома відповідями познач щонайменше дві правильні.",
    );
  }
  if (
    !Number.isInteger(question.points) ||
    question.points < 1 ||
    question.points > 100
  ) {
    throw new Error("Кількість балів має бути від 1 до 100.");
  }
  if (question.explanation.length > 2000)
    throw new Error("Пояснення має бути до 2000 символів.");
  return {
    text,
    questionType: question.questionType,
    points: question.points,
    explanation: question.explanation.trim() || null,
    options,
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TestEditorPage() {
  const { testId } = useParams<{ testId: string }>();
  return testId ? (
    <ExistingTestEditor key={testId} testId={testId} />
  ) : (
    <CreateTestPage />
  );
}

function CreateTestPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TestKind>("test");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function handleCreate() {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError("");
    let draftId: string | null = null;
    try {
      const draft = await createTest({
        title: title.trim(),
        description: description.trim() || null,
        kind,
      });
      draftId = draft.id;
      setCreatedId(draft.id);
      // Unlike legacy tests, new tests start with one attempt by default.
      await updateTestSettings(draft.id, { maxAttempts: 1 });
      navigate(`/teacher/tests/${draft.id}/edit`, { replace: true });
    } catch (err) {
      setError(
        draftId
          ? `Чернетку створено, але параметр спроб не збережено: ${errorText(err)}. Відкрий існуючу чернетку нижче.`
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page}>
      <Link to="/teacher/tests" className={styles.back}>
        <ArrowLeft size={16} /> До моїх тестів
      </Link>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>НОВИЙ ТЕСТ</p>
        <h1>Створення тесту</h1>
        <p>Від першого запитання до нового навчального завдання.</p>
      </header>
      {error && (
        <Alert tone="error" title="Помилка створення">
          {error}
        </Alert>
      )}
      {createdId && (
        <Link
          to={`/teacher/tests/${createdId}/edit`}
          className={styles.primaryLink}
        >
          Відкрити створену чернетку
        </Link>
      )}
      <div className={styles.newGrid}>
        <Card className={styles.panel} elevated>
          <div className={styles.panelTitle}>
            <h2>Про тест</h2>
            <small>* Обов'язкові поля</small>
          </div>
          <Field label="Назва тесту *">
            <input
              value={title}
              required
              maxLength={200}
              autoFocus
              placeholder="Наприклад, Основи екології"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Опис для студентів">
            <textarea
              rows={4}
              maxLength={2000}
              placeholder="Коротко опиши завдання"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Тип завдання">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as TestKind)}
            >
              <option value="test">Тест з оцінюванням</option>
              <option value="survey">Опитування без оцінювання</option>
            </select>
          </Field>
          <div className={styles.createActions}>
            <Button
              loading={busy}
              disabled={!title.trim() || busy}
              onClick={() => void handleCreate()}
            >
              <FilePlus2 size={17} /> Створити чернетку
            </Button>
          </div>
        </Card>
        <Card className={styles.panel}>
          <div className={styles.introSide}>
            <Info size={20} />
            <h2>Наступний крок</h2>
            <p>
              Після створення чернетки додаси питання, правильні відповіді, бали
              й пояснення.
            </p>
            <p>Параметри проходження налаштовуються в редакторі.</p>
          </div>
        </Card>
      </div>
    </section>
  );
}

function ExistingTestEditor({ testId }: { testId: string }) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [metadata, setMetadata] = useState<MetadataForm | null>(null);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [question, setQuestion] = useState<QuestionForm>(newQuestion);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [questionDirty, setQuestionDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const settings = await getTestSettings(testId); // Verifies that the creator owns this test.
        const [versions, data] = await Promise.all([
          getVersions(testId),
          settings.status === "draft"
            ? getEditableTest(testId)
            : getTestDetails(testId),
        ]);
        if (!active) return;
        const editor =
          settings.status === "draft" ? (data as EditableTest) : null;
        const published =
          settings.status === "published" ? (data as TestDetails) : null;
        setLoaded({ settings, versions, editor, published });
        setMetadata(metadataFromSettings(settings));
        if (editor) {
          const first = editor.questions[0];
          setSelectedQuestionId(first?.id ?? null);
          setQuestion(first ? questionFromSaved(first) : newQuestion());
        }
      } catch (error) {
        if (active) setLoadError(errorText(error));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [testId]);

  async function refreshEditor(focusId?: string | null) {
    const [editor, settings, versions] = await Promise.all([
      getEditableTest(testId),
      getTestSettings(testId),
      getVersions(testId),
    ]);
    setLoaded({ settings, versions, editor, published: null });
    setMetadata(metadataFromSettings(settings));
    setMetadataDirty(false);
    const preferred = focusId === undefined ? selectedQuestionId : focusId;
    const selected =
      editor.questions.find((item) => item.id === preferred) ??
      editor.questions[0];
    setSelectedQuestionId(selected?.id ?? null);
    setQuestion(selected ? questionFromSaved(selected) : newQuestion());
    setQuestionDirty(false);
  }

  function updateMetadata<K extends keyof MetadataForm>(
    key: K,
    value: MetadataForm[K],
  ) {
    setMetadata((current) => (current ? { ...current, [key]: value } : null));
    setMetadataDirty(true);
    setNotice("");
  }
  function updateQuestion(patch: Partial<QuestionForm>) {
    setQuestion((current) => ({ ...current, ...patch }));
    setQuestionDirty(true);
    setNotice("");
  }
  function selectQuestion(nextId: string | null) {
    if (
      questionDirty &&
      !window.confirm("Є незбережені зміни питання. Перейти без збереження?")
    )
      return;
    const selected = loaded?.editor?.questions.find(
      (item) => item.id === nextId,
    );
    setSelectedQuestionId(nextId);
    setQuestion(selected ? questionFromSaved(selected) : newQuestion());
    setQuestionDirty(false);
    setActionError("");
    setNotice("");
  }
  function updateOption(key: string, patch: Partial<QuestionOption>) {
    updateQuestion({
      options: question.options.map((option) =>
        option.key === key ? { ...option, ...patch } : option,
      ),
    });
  }
  function markCorrect(key: string) {
    updateQuestion({
      options: question.options.map((option) => ({
        ...option,
        isCorrect:
          question.questionType === "single_choice"
            ? option.key === key
            : option.key === key
              ? !option.isCorrect
              : option.isCorrect,
      })),
    });
  }

  async function saveQuestion() {
    if (!loaded?.editor || busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const payload = questionPayload(question, loaded.settings.kind);
      let id = selectedQuestionId;
      if (id) await updateWeightedQuestion(testId, id, payload);
      else {
        const created = await addWeightedQuestion(testId, payload);
        id = created.id;
      }
      await refreshEditor(id);
      setNotice("Питання збережено.");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!loaded?.editor || !metadata || busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      if (!metadata.title.trim()) throw new Error("Назва тесту обов’язкова.");
      await updateTest(testId, {
        title: metadata.title.trim(),
        description: metadata.description.trim() || null,
      });
      await updateTestSettings(testId, settingsPayload(metadata));
      let id = selectedQuestionId;
      if (questionDirty) {
        const payload = questionPayload(question, loaded.settings.kind);
        if (id) await updateWeightedQuestion(testId, id, payload);
        else {
          const created = await addWeightedQuestion(testId, payload);
          id = created.id;
        }
      }
      await refreshEditor(id);
      setNotice("Чернетку та зміни успішно збережено.");
    } catch (err) {
      setActionError(
        `Не вдалося зберегти всі зміни: ${errorText(err)}. Частина попередніх операцій могла зберегтися — перевір чернетку.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function duplicateQuestion() {
    if (!loaded?.editor || !selectedQuestionId || busy) return;
    if (
      questionDirty &&
      !window.confirm(
        "Незбережені зміни поточного питання не дублюватимуться. Продовжити?",
      )
    )
      return;
    const saved = loaded.editor.questions.find(
      (item) => item.id === selectedQuestionId,
    );
    if (!saved) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const copy = questionFromSaved(saved);
      const added = await addWeightedQuestion(
        testId,
        questionPayload(copy, loaded.settings.kind),
      );
      await refreshEditor(added.id);
      setNotice("Питання дубльовано.");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestion() {
    if (!selectedQuestionId || busy) return;
    if (
      !window.confirm("Видалити це питання з чернетки? Дію не можна скасувати.")
    )
      return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await deleteDraftQuestion(testId, selectedQuestionId);
      await refreshEditor(null);
      setNotice("Питання видалено з чернетки.");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!loaded?.editor || busy) return;
    if (metadataDirty || questionDirty) {
      setActionError("Спочатку збережи зміни чернетки й питання.");
      return;
    }
    if (loaded.editor.questions.length === 0) {
      setActionError("Перед публікацією додай хоча б одне питання.");
      return;
    }
    if (
      !window.confirm(
        "Опублікувати цю версію тесту? Після публікації її питання змінювати не можна.",
      )
    )
      return;
    setBusy(true);
    setActionError("");
    try {
      await publishTest(testId);
      const [settings, versions, published] = await Promise.all([
        getTestSettings(testId),
        getVersions(testId),
        getTestDetails(testId),
      ]);
      setLoaded({ settings, versions, editor: null, published });
      setMetadata(metadataFromSettings(settings));
      setMetadataDirty(false);
      setQuestionDirty(false);
      setNotice("Версію тесту опубліковано.");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRevision() {
    if (!loaded?.published || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const { draftId } = await createDraftRevision(testId);
      navigate(`/teacher/tests/${draftId}/edit`);
    } catch (err) {
      setActionError(errorText(err));
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <section className={styles.page}>
        <Alert tone="error" title="Не вдалося відкрити тест">
          {loadError}
        </Alert>
        <Link to="/teacher/tests">До моїх тестів</Link>
      </section>
    );
  if (!loaded || !metadata)
    return <p role="status">Завантажуємо редактор тесту…</p>;

  const isDraft = !!loaded.editor;
  const activeQuestions = isDraft
    ? loaded.editor!.questions
    : (loaded.published?.questions ?? []);
  const currentVersion = loaded.versions.find(
    (item) => item.is_current && item.status === "published",
  );
  const draftVersion = loaded.versions.find((item) => item.status === "draft");
  const count = activeQuestions.length;
  const totalPoints = isDraft
    ? loaded.editor!.questions.reduce((sum, item) => sum + item.points, 0)
    : (loaded.published?.questions ?? []).reduce(
        (sum, item) => sum + pointsOf(item),
        0,
      );

  return (
    <section className={styles.page}>
      <Link to="/teacher/tests" className={styles.back}>
        <ArrowLeft size={16} aria-hidden="true" /> До моїх тестів
      </Link>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>
          {isDraft ? "РЕДАГУВАННЯ ЧЕРНЕТКИ" : "ОПУБЛІКОВАНИЙ ТЕСТ"}
        </p>
        <h1>
          {isDraft
            ? loaded.settings.version_number === 1
              ? "Створення тесту"
              : metadata.title
            : metadata.title}
        </h1>
        <p>
          {isDraft
            ? "Керуйте питаннями та параметрами нової версії."
            : "Опубліковану версію можна переглядати, але не змінювати."}
        </p>
        <div className={styles.badgeLine}>
          <span className={isDraft ? styles.draftPill : styles.publishedPill}>
            {isDraft ? "Чернетка" : "Опубліковано"}
          </span>
          <span>Версія {loaded.settings.version_number}</span>
          {isDraft && loaded.settings.version_number > 1 && (
            <span>Попередні результати зберігаються</span>
          )}
        </div>
      </header>

      {loaded.settings.version_number > 1 && isDraft && (
        <Alert tone="info" title="Нова версія тесту">
          Після публікації нова версія стане актуальною. Попередні оцінки
          студентів залишаться прив'язаними до старої версії.
        </Alert>
      )}
      {actionError && (
        <Alert tone="error" title="Не вдалося виконати дію">
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" title="Збережено">
          {notice}
        </Alert>
      )}

      {!isDraft ? (
        <div className={styles.publishedLayout}>
          <Card className={styles.panel} elevated>
            <div className={styles.panelTitle}>
              <h2>Про тест</h2>
              <span>{count} запитань</span>
            </div>
            <dl className={styles.readOnlyGrid}>
              <div>
                <dt>Назва</dt>
                <dd>{metadata.title}</dd>
              </div>
              <div>
                <dt>Опис</dt>
                <dd>{metadata.description || "—"}</dd>
              </div>
              <div>
                <dt>Предмет</dt>
                <dd>{metadata.subject || "—"}</dd>
              </div>
              <div>
                <dt>Група</dt>
                <dd>{metadata.classGroup || "—"}</dd>
              </div>
              <div>
                <dt>Максимальний бал</dt>
                <dd>
                  {loaded.settings.kind === "test"
                    ? totalPoints
                    : "Без оцінювання"}
                </dd>
              </div>
              <div>
                <dt>Час проходження</dt>
                <dd>
                  {metadata.durationMinutes
                    ? `${metadata.durationMinutes} хв`
                    : "Не налаштовано"}
                </dd>
              </div>
            </dl>
            <h3 className={styles.subheading}>Запитання</h3>
            {(loaded.published?.questions ?? []).map((item, index) => (
              <div className={styles.previewQuestion} key={item.id}>
                <strong>
                  {index + 1}. {item.text}
                </strong>
                <span>{pointsOf(item)} бал.</span>
                <ol>
                  {item.options.map((option) => (
                    <li key={option.id}>{option.text}</li>
                  ))}
                </ol>
              </div>
            ))}
            <p className={styles.hint}>
              Ключі відповідей не повертаються звичайним API перегляду тесту.
              Для зміни питань створи чернетку наступної версії.
            </p>
          </Card>
          <div className={styles.sideColumn}>
            <Card className={styles.panel}>
              <h2>Історія версій</h2>
              <VersionList versions={loaded.versions} />
              {draftVersion ? (
                <Link
                  className={styles.primaryLink}
                  to={`/teacher/tests/${draftVersion.id}/edit`}
                >
                  Продовжити редагування версії {draftVersion.version_number}
                </Link>
              ) : currentVersion?.id === testId ? (
                <Button
                  fullWidth
                  loading={busy}
                  disabled={busy}
                  onClick={() => void handleCreateRevision()}
                >
                  <PencilLine size={17} /> Створити нову версію
                </Button>
              ) : currentVersion ? (
                <Link
                  className={styles.primaryLink}
                  to={`/teacher/tests/${currentVersion.id}/edit`}
                >
                  До актуальної версії
                </Link>
              ) : null}
            </Card>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.editorGrid}>
            <div className={styles.questionListArea}>
              <Card className={styles.panel}>
                <div className={styles.panelTitle}>
                  <h2>Запитання</h2>
                  <span>{count}</span>
                </div>
                <div className={styles.questionList}>
                  {loaded.editor!.questions.map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={busy}
                      className={`${styles.questionLink} ${selectedQuestionId === item.id ? styles.questionLinkActive : ""}`}
                      onClick={() => selectQuestion(item.id)}
                      aria-current={
                        selectedQuestionId === item.id ? "true" : undefined
                      }
                    >
                      <span>
                        {index + 1}. {item.text}
                      </span>
                      <small>
                        {item.question_type === "single_choice"
                          ? "Одна відповідь"
                          : "Кілька відповідей"}{" "}
                        · {item.points} бал.
                      </small>
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  fullWidth
                  disabled={busy}
                  onClick={() => selectQuestion(null)}
                >
                  <Plus size={17} /> Додати запитання
                </Button>
              </Card>
            </div>

            <div className={styles.metadataArea}>
              <Card className={styles.panel} elevated>
                <div className={styles.panelTitle}>
                  <h2>Про тест</h2>
                  <small>* Обов'язкові поля</small>
                </div>
                <Field label="Назва тесту *">
                  <input
                    value={metadata.title}
                    maxLength={200}
                    required
                    onChange={(event) =>
                      updateMetadata("title", event.target.value)
                    }
                  />
                </Field>
                <Field label="Опис для студентів">
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={metadata.description}
                    onChange={(event) =>
                      updateMetadata("description", event.target.value)
                    }
                  />
                </Field>
                <Field label="Предмет">
                  <input
                    maxLength={120}
                    placeholder="Наприклад, Біологія"
                    value={metadata.subject}
                    onChange={(event) =>
                      updateMetadata("subject", event.target.value)
                    }
                  />
                </Field>
                <p className={styles.hint}>
                  Тип:{" "}
                  {loaded.settings.kind === "test"
                    ? "тест з оцінюванням"
                    : "опитування"}{" "}
                  — після створення не змінюється.
                </p>
              </Card>
            </div>

            <div className={styles.questionArea}>
              <Card className={styles.panel} elevated>
                <div className={styles.panelTitle}>
                  <span className={styles.questionNumber}>
                    {selectedQuestionId
                      ? `Запитання ${loaded.editor!.questions.findIndex((item) => item.id === selectedQuestionId) + 1} з ${count}`
                      : "Нове запитання"}
                  </span>
                  <div className={styles.iconActions}>
                    <button
                      type="button"
                      title="Дублювати питання"
                      aria-label="Дублювати питання"
                      disabled={!selectedQuestionId || busy}
                      onClick={() => void duplicateQuestion()}
                    >
                      <Copy size={17} />
                    </button>
                    <button
                      type="button"
                      title="Видалити питання"
                      aria-label="Видалити питання"
                      disabled={!selectedQuestionId || busy}
                      onClick={() => void removeQuestion()}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
                <Field label="Текст запитання *">
                  <textarea
                    rows={3}
                    maxLength={5000}
                    value={question.text}
                    placeholder="Введи питання"
                    onChange={(event) =>
                      updateQuestion({ text: event.target.value })
                    }
                  />
                </Field>
                <div className={styles.twoColumns}>
                  <Field label="Тип запитання">
                    <select
                      value={question.questionType}
                      onChange={(event) =>
                        updateQuestion({
                          questionType: event.target.value as ChoiceKind,
                          options: question.options.map((option) => ({
                            ...option,
                            isCorrect: false,
                          })),
                        })
                      }
                    >
                      <option value="single_choice">Одна відповідь</option>
                      <option value="multiple_choice">Кілька відповідей</option>
                    </select>
                  </Field>
                  {loaded.settings.kind === "test" && (
                    <Field label="Бали">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={question.points}
                        onChange={(event) =>
                          updateQuestion({ points: Number(event.target.value) })
                        }
                      />
                    </Field>
                  )}
                </div>
                <div className={styles.optionsHeader}>
                  <h3>Варіанти відповідей</h3>
                  <p>
                    {loaded.settings.kind === "survey"
                      ? "Для опитування правильні відповіді не позначаються."
                      : question.questionType === "single_choice"
                        ? "Познач колом одну правильну відповідь."
                        : "Познач усі правильні відповіді."}
                  </p>
                </div>
                <div className={styles.optionList}>
                  {question.options.map((option, index) => (
                    <div
                      key={option.key}
                      className={`${styles.optionRow} ${option.isCorrect && loaded.settings.kind === "test" ? styles.correctOption : ""}`}
                    >
                      {loaded.settings.kind === "test" ? (
                        <input
                          type={
                            question.questionType === "single_choice"
                              ? "radio"
                              : "checkbox"
                          }
                          name={`correct-${testId}`}
                          aria-label={`Правильна відповідь ${index + 1}`}
                          checked={option.isCorrect}
                          onChange={() => markCorrect(option.key)}
                        />
                      ) : (
                        <span className={styles.optionLetter}>{index + 1}</span>
                      )}
                      <input
                        type="text"
                        aria-label={`Варіант ${index + 1}`}
                        maxLength={1000}
                        placeholder={`Варіант ${index + 1}`}
                        value={option.text}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          updateOption(option.key, { text: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        title="Видалити варіант"
                        aria-label={`Видалити варіант ${index + 1}`}
                        disabled={busy || question.options.length <= 2}
                        onClick={() =>
                          updateQuestion({
                            options: question.options.filter(
                              (item) => item.key !== option.key,
                            ),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  disabled={busy || question.options.length >= 12}
                  onClick={() =>
                    updateQuestion({
                      options: [...question.options, blankOption()],
                    })
                  }
                >
                  <Plus size={17} /> Додати варіант
                </Button>
                {loaded.settings.kind === "test" && (
                  <Field label="Пояснення після відповіді">
                    <textarea
                      rows={3}
                      maxLength={2000}
                      placeholder="Поясни правильну відповідь (не показується до завершення тесту)"
                      value={question.explanation}
                      onChange={(event) =>
                        updateQuestion({ explanation: event.target.value })
                      }
                    />
                  </Field>
                )}
                <div className={styles.questionActions}>
                  <Button
                    disabled={busy}
                    loading={busy}
                    onClick={() => void saveQuestion()}
                  >
                    <CheckCircle2 size={17} /> Зберегти питання
                  </Button>
                  {questionDirty && <span>Є незбережені зміни питання</span>}
                </div>
              </Card>
            </div>

            <div className={styles.settingsArea}>
              <Card className={styles.panel}>
                <h2>Параметри тесту</h2>
                <Field label="Група">
                  <input
                    maxLength={80}
                    value={metadata.classGroup}
                    placeholder="Наприклад, 10-А"
                    onChange={(event) =>
                      updateMetadata("classGroup", event.target.value)
                    }
                  />
                </Field>
                <Field label="Час на тест (хв)">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    placeholder="Не встановлено"
                    value={metadata.durationMinutes}
                    onChange={(event) =>
                      updateMetadata("durationMinutes", event.target.value)
                    }
                  />

                  <p className={styles.fieldHint}>
                    Поки лише налаштування. Серверний таймер з'явиться на етапі
                    активних спроб.
                  </p>
                </Field>
                <Field label="Кількість спроб">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    placeholder="Без обмеження"
                    value={metadata.maxAttempts}
                    onChange={(event) =>
                      updateMetadata("maxAttempts", event.target.value)
                    }
                  />

                  <p className={styles.fieldHint}>
                    Ліміт діє на всі версії тесту разом.
                  </p>
                </Field>
                <Field label="Доступний до">
                  <input
                    type="datetime-local"
                    value={metadata.availableUntil}
                    onChange={(event) =>
                      updateMetadata("availableUntil", event.target.value)
                    }
                  />

                  <p className={styles.fieldHint}>
                    Дата й час у часовому поясі цього пристрою.
                  </p>
                </Field>
                <div className={styles.checkGroup}>
                  <label>
                    <input
                      type="checkbox"
                      checked={metadata.showResultImmediately}
                      onChange={(event) =>
                        updateMetadata(
                          "showResultImmediately",
                          event.target.checked,
                        )
                      }
                    />{" "}
                    Показувати результат одразу
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={metadata.showCorrectAnswers}
                      onChange={(event) =>
                        updateMetadata(
                          "showCorrectAnswers",
                          event.target.checked,
                        )
                      }
                    />{" "}
                    Показувати правильні відповіді
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={metadata.shuffleQuestions}
                      onChange={(event) =>
                        updateMetadata("shuffleQuestions", event.target.checked)
                      }
                    />{" "}
                    Перемішувати запитання
                  </label>
                </div>
                <p className={styles.hint}>
                  Показ правильних відповідей і перемішування застосуємо в
                  наступному Test Runner / Results. Ці перемикачі вже
                  зберігаються в БД.
                </p>
              </Card>
              <div className={styles.summaryPanel}>
                <strong>Чернетка зберігається для вас</strong>
                <p>
                  Збережи всі зміни перед публікацією. Студенти побачать нову
                  версію лише після публікації.
                </p>
                <span>
                  {count} запитань ·{" "}
                  {loaded.settings.kind === "test"
                    ? `${totalPoints} балів`
                    : "опитування"}{" "}
                  {metadata.durationMinutes
                    ? `· ${metadata.durationMinutes} хв`
                    : ""}
                </span>
              </div>
            </div>
          </div>
          {preview && (
            <Card className={styles.previewPanel}>
              <div className={styles.panelTitle}>
                <h2>Попередній перегляд збережених питань</h2>
                <button
                  type="button"
                  aria-label="Закрити попередній перегляд"
                  onClick={() => setPreview(false)}
                >
                  <X size={18} />
                </button>
              </div>
              {loaded.editor!.questions.length === 0 && (
                <p>Поки що немає збережених питань.</p>
              )}
              {loaded.editor!.questions.map((item, index) => (
                <div className={styles.previewQuestion} key={item.id}>
                  <strong>
                    {index + 1}. {item.text}
                  </strong>
                  <span>{item.points} бал.</span>
                  <ul>
                    {item.options.map((option) => (
                      <li key={option.id}>{option.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className={styles.hint}>
                Попередній перегляд не показує правильні відповіді та не створює
                спробу.
              </p>
            </Card>
          )}
          <footer className={styles.footerActions}>
            <Button
              variant="outline"
              onClick={() => setPreview((shown) => !shown)}
            >
              <Eye size={17} /> Попередній перегляд
            </Button>
            <div className={styles.footerRight}>
              <Button
                variant="outline"
                loading={busy}
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                Зберегти чернетку
              </Button>
              <Button
                disabled={busy || count === 0}
                onClick={() => void handlePublish()}
              >
                <Send size={17} />{" "}
                {loaded.settings.version_number === 1
                  ? "Опублікувати тест"
                  : "Опублікувати зміни"}
              </Button>
            </div>
          </footer>
          <p className={styles.footerNote}>
            {metadataDirty || questionDirty
              ? "Є незбережені зміни."
              : "Усі відображені дані завантажені з сервера. Незбережені зміни не синхронізуються автоматично."}
          </p>
        </>
      )}
    </section>
  );
}

function VersionList({ versions }: { versions: VersionRecord[] }) {
  return (
    <ul className={styles.versions}>
      {versions.map((version) => (
        <li key={version.id}>
          <Link to={`/teacher/tests/${version.id}/edit`}>
            Версія {version.version_number}
            <small>
              {version.status === "draft"
                ? "Чернетка"
                : version.is_current
                  ? "Актуальна"
                  : "Архівна"}
            </small>
          </Link>
        </li>
      ))}
    </ul>
  );
}
