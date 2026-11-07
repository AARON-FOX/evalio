import { Link } from "react-router";

import { useAuth } from '../context/useAuth';

export function DashboardPage() {
  const { profile } = useAuth();

  if (!profile) {
    return <p>Завантаження кабінету...</p>;
  }

  const isCreator = profile.role === "creator";

  return (
    <section className="dashboard-page">
      <h1>Особистий кабінет</h1>

      <p>Вітаємо в Evalio!</p>

      <p>
        Роль: <strong>{isCreator ? "Викладач" : "Студент"}</strong>
      </p>

      <div className="dashboard-grid">
        {isCreator ? (
          <>
            <Link to="/teacher/tests" className="dashboard-card">
              <h2>Конструктор тестів</h2>
              <p>Створення, редагування чернеток і публікація тестів.</p>
            </Link>

            <Link to="/teacher/statistics" className="dashboard-card">
              <h2>Статистика</h2>
              <p>Результати студентів, кількість проходжень та оцінки.</p>
            </Link>
          </>
        ) : (
          <Link to="/tests" className="dashboard-card">
            <h2>Доступні тести</h2>
            <p>Переглядай тести, проходь опитування та отримуй результати.</p>
          </Link>
        )}
      </div>
    </section>
  );
}
