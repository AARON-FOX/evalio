# Evalio

**Evalio — вебплатформа для створення, проходження та аналізу тестів і опитувань.**

Навчальний full-stack проєкт з адаптивним інтерфейсом, рольовою моделлю доступу, автоматичним оцінюванням та збереженням історії проходжень.

**[Відкрити Evalio](https://evalio-platform.netlify.app)** · [GitHub-репозиторій](https://github.com/AARON-FOX/evalio) · [Перевірити стан API](https://evalio-pprh.onrender.com/api/health)

## Можливості

### Для студента (`respondent`)

- Реєстрація, вхід і відновлення пароля через Supabase Auth.
- Каталог опублікованих тестів і опитувань з інформацією про завдання до початку спроби.
- Перегляд опису, кількості питань, часових обмежень, дедлайну та доступних спроб.
- Проходження тестів із навігацією між питаннями, серверним таймером та автозбереженням відповідей.
- Запитання з однією або кількома правильними відповідями; підтримка тексту й зображень у питаннях і варіантах.
- Перегляд результатів, історії спроб і пояснень там, де це дозволено налаштуваннями тесту.

### Для викладача (`creator`)

- Створення тестів та опитувань, робота з чернетками та публікація.
- Додавання, редагування, дублювання та видалення питань і варіантів відповідей.
- Налаштування правильних відповідей, ваги питань (балів), пояснень, часу, дедлайну та ліміту спроб.
- Завантаження зображень до питань та варіантів відповідей.
- Версіонування тестів: нові редакції не змінюють уже завершені проходження.
- Архівування неактуальних тестів зі збереженням історії студентських результатів.
- Dashboard, статистика тестувань та перегляд проходжень.

### Для супер-адміністратора (`admin`)

- Список користувачів із пошуком, фільтрами та пагінацією.
- Призначення й відкликання ролі викладача (`respondent` ↔ `creator`).
- Журнал змін ролей.
- Обмеження привілейованих дій і захист від самостійного призначення прав адміністратора.

## Технології

| Частина | Стек |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router |
| Стани та запити | Redux Toolkit, React Redux, RTK Query, React Hooks, AuthContext |
| Стилі | SCSS, CSS Modules, Inter, Lucide Icons |
| Backend | Node.js, Express 5, TypeScript, Zod |
| База даних | PostgreSQL (Supabase), SQL-функції, тригери, RLS |
| Авторизація | Supabase Auth, JWT, рольові middleware |
| Зображення | Supabase Storage (приватний bucket, тимчасові URL) |
| Деплой | Netlify (frontend), Render (backend), Supabase (БД/Auth/Storage) |

## Архітектура

```text
Браузер
  │
  ▼
React + React Router + RTK Query  [Netlify]
  │ REST API / Bearer JWT
  ▼
Node.js + Express + TypeScript    [Render]
  │
  ├── перевірка JWT, ролей і доступу
  ├── валідація запитів (Zod)
  └── бізнес-логіка тестів та спроб
             │
             ▼
Supabase: PostgreSQL + Auth + Storage
```

**Ключові принципи:** сервер перевіряє права доступу; оцінювання та обмеження спроб виконуються на сервері; правильні відповіді не передаються студенту під час проходження; історичні результати прив'язані до конкретної версії тесту.

## Структура репозиторію

```text
evalio/
├── frontend/              # React-застосунок, сторінки та UI-компоненти
│   ├── src/
│   │   ├── app/           # Redux Store, RTK Query, slices
│   │   ├── components/    # UI Kit та функціональні компоненти
│   │   ├── context/       # Контекст авторизації
│   │   ├── layouts/       # Адаптивні макети сторінок
│   │   ├── pages/         # Сторінки за маршрутами
│   │   ├── services/      # Допоміжні API-сервіси
│   │   └── styles/        # SCSS-дизайн-система
│   └── public/_redirects  # SPA fallback для Netlify
├── backend/
│   └── src/
│       ├── routes/        # REST API маршрути
│       ├── middleware/    # Авторизація та перевірка ролей
│       └── lib/           # Клієнти Supabase
├── supabase/sql/          # SQL-міграції та функції PostgreSQL
└── README.md
```

## Локальний запуск

### Передумови

- Node.js 24 та npm.
- Supabase-проєкт із налаштованими Authentication, PostgreSQL та Storage.
- Застосовані SQL-міграції з `supabase/sql/` (для нового середовища — у правильному порядку).

### 1. Клонування

```bash
git clone https://github.com/AARON-FOX/evalio.git
cd evalio
```

### 2. Backend

Створити `backend/.env`:

```dotenv
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
```

Запустити:

```bash
cd backend
npm ci
npm run dev
```

API доступний на `http://localhost:3001`. Перевірка: `http://localhost:3001/api/health`.

### 3. Frontend

В іншому терміналі створити `frontend/.env.local`:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Запустити:

```bash
cd frontend
npm ci
npm run dev
```

Відкрити `http://localhost:5173`.

> **Безпека:** `SUPABASE_SECRET_KEY` використовується **лише на backend**. Ніколи не додавате його у змінні `VITE_*`, React-код, Git-коміти або README. Файли `.env` та `.env.local` не повинні потрапляти до репозиторію.

## Основні API-маршрути

| Метод / маршрут | Призначення |
| --- | --- |
| `GET /api/health` | Перевірка працездатності сервера |
| `GET /api/me` | Поточний користувач і роль |
| `GET /api/tests` | Список доступних тестів |
| `POST /api/tests` | Створення тесту викладачем |
| `GET /api/tests/:id/overview` | Інформація про тест перед проходженням |
| `DELETE /api/tests/:id` | Безпечне архівування тесту |
| `GET /api/submissions/mine` | Історія проходжень студента |
| `GET /api/submissions/:id/result` | Детальний результат проходження |

Є також маршрути редагування питань, керування версіями, активними спробами, статистикою та користувачами. Захищені запити потребують `Authorization: Bearer <JWT>` і відповідної ролі.

## Перевірка якості

```bash
# frontend
cd frontend
npm run lint
npm run build

# backend
cd ../backend
npm run typecheck
npm run build
```

## Розгортання

- **Frontend:** [Netlify](https://evalio-platform.netlify.app) — коренева директорія `frontend`, команда `npm run build`, каталог `dist`.
- **Backend:** [Render](https://evalio-pprh.onrender.com/api/health) — коренева директорія `backend`, команди `npm ci && npm run build` та `npm start`.
- **Data / Auth / Storage:** Supabase.

> Використовується бескоштовний тариф Render, перший запит після періоду неактивності може виконуватися довше.

## Про проєкт

Evalio (від Evaluation) - навчальний курсовий full-stack проєкт. Роботу розділено на **frontend** (React, інтерфейс, маршрутизація та взаємодія з API) і **backend** (Express, база даних, авторизація, бізнес-правила та захист даних).

---

**Evalio — створюй, проходь, аналізуй.**
