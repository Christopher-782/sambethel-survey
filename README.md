# Sambethel Taste Feedback Website

A professional customer feedback website for Sambethel Taste bread, using MongoDB for shared response storage and a password-protected management dashboard.

## What is included

- Public 5-question bread feedback form
- Green and orange Sambethel Taste visual theme
- Responsive mobile and desktop design
- MongoDB storage for every customer response
- Private admin login, with the dashboard hidden from customers
- HttpOnly admin session cookie so the admin password is not stored in browser JavaScript
- Executive customer-feedback report with plain-language insights
- Total responses, overall score, average quality, taste satisfaction, freshness satisfaction and value-for-money KPIs
- Improvement-priority ranking and value-perception breakdown
- Quality-rating distribution and recent response table
- CSV export
- Print / Save PDF report button
- Server-side validation and basic login-attempt throttling

## 1. Create your MongoDB database

1. Sign in to MongoDB Atlas and create a cluster/deployment.
2. Create a database user with a strong password.
3. Configure Atlas Network Access for the machine or hosting service running this app.
4. In Atlas, choose **Connect > Drivers > Node.js** and copy the connection string.

Never put the MongoDB connection string in `public/index.html`.

## 2. Configure the app

Copy `.env.example` to `.env` and fill in your values:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=sambethel_taste
ADMIN_KEY=choose-a-long-private-admin-password
PORT=3000
NODE_ENV=development
```

For an online HTTPS deployment, set `NODE_ENV=production` so the admin session cookie is marked `Secure`.

If the MongoDB password contains reserved URL characters such as `@`, `:`, `/`, `?`, `#`, `[`, or `]`, URL-encode the password in the connection string.

## 3. Install and run

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Customers see only the survey. Click **Admin Login** and enter the `ADMIN_KEY` to open the private analysis dashboard.

## 4. Deploy online

Deploy to a Node-compatible host such as Render, Railway, Fly.io, or a VPS. Set these environment variables in the hosting dashboard rather than uploading your `.env` file:

- `MONGODB_URI`
- `MONGODB_DB`
- `ADMIN_KEY`
- `NODE_ENV=production`

The hosting platform usually supplies `PORT` automatically.

## Database structure

Database: `sambethel_taste` by default  
Collection: `feedback`

Each response is stored approximately as:

```json
{
  "quality": 5,
  "taste": 4,
  "freshness": 5,
  "value": "Yes",
  "improvement": "Better packaging",
  "comment": "Optional customer comment",
  "createdAt": "MongoDB Date"
}
```

## Main routes

- `POST /api/feedback` public feedback submission
- `GET /api/health` database connectivity check
- `POST /api/admin/login` verifies the private admin password and creates a server-side session
- `GET /api/admin/session` checks whether the current browser has an authenticated admin session
- `POST /api/admin/logout` signs the admin out
- `GET /api/dashboard` authenticated admin only
- `GET /api/export.csv` authenticated admin only

## Security notes

- Keep `.env` private and never commit it.
- Use HTTPS in production.
- Use a long, unique `ADMIN_KEY`.
- Use a dedicated MongoDB database user with only the permissions this app needs.
- Restrict Atlas network access to your hosting environment where practical.
- The included session store is in server memory. This is suitable for a small single-server deployment. If you later run multiple server instances, move sessions to a shared store such as Redis.
