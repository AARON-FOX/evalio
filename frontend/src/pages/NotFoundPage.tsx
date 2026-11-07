import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <h2>Сторінку не знайдено</h2>

      <p>Можливо, адресу було змінено або сторінка більше не існує.</p>

      <Link to="/dashboard">Повернутися до Evalio</Link>
    </div>
  );
}
