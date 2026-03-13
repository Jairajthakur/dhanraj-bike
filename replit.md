# Dhanraj Enterprises - Bike Recovery Management App

A bike loan recovery management mobile application for Dhanraj Enterprises, built with Expo + React Native and Express/PostgreSQL.

## Architecture

- **Frontend**: Expo Router (file-based routing), Metro dev server on port 8082 (dev only)
- **Backend**: Express.js server (port 5000 primary + port 8081 secondary in dev) - serves REST API. In dev, port 8081 proxies Metro for Android Expo Go access via standard HTTPS port.
- **Database**: PostgreSQL with four tables: `users`, `allocations`, `repo_allocations`, `notifications`
- **Auth**: Express-session with plain-text password comparison (role-based: admin / fos / repo)
- **UI Theme**: Dark amber/charcoal (#0F0F0F bg, #F59E0B amber primary)

## User Roles

### Admin
- Manages users (create/delete admin, FOS, and Repo accounts)
- Upload Excel files to bulk-insert allocation data (separate sections for FOS and Repo data)
- View FOS activity notifications (who searched which vehicle)

### FOS (Field Officer)
- Search allocations by vehicle registration number
- View full customer/loan details on a detail screen
- Each detail view automatically notifies admin

### Repo (Repossession Officer)
- Search repo_allocations by vehicle registration number
- View full repo allocation details on a detail screen
- Does NOT trigger admin notifications on view

## Key Features

- Role-based routing: admin → `/(admin)` tabs; FOS → `/(fos)/search`; Repo → `/(repo)/search`
- Excel upload via `expo-document-picker` + `multer` + `xlsx` library
- Flexible column mapping for Excel headers (handles variations)
- Notification badge on admin Notifications tab (unread count)
- Phone number tap-to-call on allocation detail screen
- Allocation detail screen sends notification to admin on view

## Project Structure

```
app/
  _layout.tsx              # Root stack layout with providers
  index.tsx                # Auth redirect (admin vs fos vs login)
  login.tsx                # Login screen
  (admin)/
    _layout.tsx            # Admin tab layout (Users, Upload, Notifications)
    users.tsx              # User management screen
    upload.tsx             # Excel upload screen
    notifications.tsx      # FOS activity notifications screen
  (fos)/
    _layout.tsx            # FOS tab layout (Search only)
    search.tsx             # Registration number search screen
  allocation/
    [id].tsx               # Full allocation detail screen (auto-notifies admin)
contexts/
  AuthContext.tsx           # Auth state (user, login, logout)
constants/
  colors.ts                # Dark amber/charcoal theme colors
server/
  index.ts                 # Express server entry
  routes.ts                # All API routes
  storage.ts               # Database queries (drizzle ORM)
  db.ts                    # Database connection
  schema.ts                # Drizzle schema definition
```

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | - | Login |
| GET | /api/auth/me | Any | Current user |
| POST | /api/auth/logout | Any | Logout |
| GET | /api/users | Admin | List users |
| POST | /api/users | Admin | Create user |
| DELETE | /api/users/:id | Admin | Delete user |
| GET | /api/allocations/search?q= | Any | Search by reg no |
| GET | /api/allocations/:id | Any | Get one allocation |
| POST | /api/allocations/bulk | Admin | Bulk insert from Excel |
| GET | /api/notifications | Admin | List notifications |
| POST | /api/notifications | FOS | Create notification |
| PATCH | /api/notifications/:id/read | Admin | Mark read |
| PATCH | /api/notifications/read-all | Admin | Mark all read |

## Database Schema

- `users`: id, username, password, role (admin/fos), created_at
- `allocations`: id + 21 fields (LOAN_NO, APP_ID, CUSTOMERNAME, EMI, EMI_DUE, CBC, LPP, CBC+LPP, POS, BKT, CUSTOMER_ADDRESS, FIRST_EMI_DUE_DATE, LOAN_MATURITY_DATE, ASSET_MAKE, REGISTRATION_NO, engine_no, chassis_no, Ten, Number, status, Detail_FB)
- `notifications`: id, fos_username, customer_name, registration_no, allocation_id, is_read, created_at

## Default Account

- Username: `admin`  Password: `admin123`  Role: admin

## Workflows

- `Start Backend`: `npm run server:dev` — Express on port 5000 (primary) + 8081 (secondary dev proxy)
- `Start Frontend`: Metro on port 8082 — `EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN` (no port) so Android Expo Go hits standard HTTPS port 80 → 8081 → backend API

## Dev Port Layout (Android Expo Go)

Port 5000 blocked on mobile networks → port 8082 (Metro) also blocked  
Fix: Backend listens on port 8081 (external port 80, never blocked). Metro on 8082 (internal).  
Android connects to standard `https://xxx.replit.dev` (port 80) for BOTH bundle + API.
